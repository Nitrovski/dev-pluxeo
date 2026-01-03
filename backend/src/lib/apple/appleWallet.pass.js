import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getAppleWalletConfig } from "./appleWallet.config.js";
import { loadDefaultAppleAssets } from "./appleWallet.assets.js";
import { buildManifest, signManifestWithOpenSSL } from "./appleWallet.sign.js";

const execFileAsync = promisify(execFile);

function toRgbString(hex) {
  const normalized = String(hex || "")
    .trim()
    .replace(/^#/, "");

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgb(${r},${g},${b})`;
}

function buildBackFields({ card }) {
  const detailsText = String(
    card?.template?.detailsText ?? card?.detailsText ?? ""
  ).trim();
  const termsText = String(
    card?.template?.termsText ?? card?.termsText ?? ""
  ).trim();

  const fields = [];

  if (detailsText) {
    fields.push({ key: "details", label: "Details", value: detailsText });
  }

  if (termsText) {
    fields.push({ key: "terms", label: "Terms", value: termsText });
  }

  return fields;
}

async function zipToBuffer(filesMap, tempDir) {
  const passDir = join(tempDir, "pass");
  const zipPath = join(tempDir, "pass.pkpass");

  await mkdir(passDir, { recursive: true });

  await Promise.all(
    Object.entries(filesMap).map(([filename, buffer]) =>
      writeFile(join(passDir, filename), buffer)
    )
  );

  await execFileAsync("zip", ["-r", "-X", zipPath, "."], { cwd: passDir });

  return await readFile(zipPath);
}

function maskRedeemCode(code) {
  const safe = String(code || "").trim();
  if (!safe) return "";
  return `${safe.slice(0, 4)}***`;
}

function pickBarcodeWithSource({ publicPayload, walletToken }) {
  const candidates = [
    {
      value: publicPayload?.redeemCode?.code,
      source: publicPayload?.redeemCode ? publicPayload.redeemCode.purpose : null,
    },
    { value: publicPayload?.activeRedeemCode?.code, source: "reward" },
    { value: publicPayload?.redeem?.code, source: "reward" },
    { value: publicPayload?.redeem?.redeemCode, source: "reward" },
    { value: publicPayload?.redeem?.value, source: "reward" },
    { value: publicPayload?.activeCode, source: "reward" },
  ];

  const picked = candidates.find(
    (candidate) => String(candidate.value || "").trim().length > 0
  );

  if (picked) {
    return {
      message: String(picked.value).trim(),
      source: picked.source || "reward",
    };
  }

  return {
    message: String(walletToken || "").trim(),
    source: "fallback",
  };
}

export async function buildApplePkpassBuffer({
  card,
  publicPayload,
  walletToken,
  customOverrides = null,
  logger,
}) {
  const cfg = getAppleWalletConfig({ logger });
  const tempDir = await mkdtemp(join(tmpdir(), "apple-wallet-pass-"));
  const p12Path = join(tempDir, "pass.p12");
  const certPath = join(tempDir, "pass_cert.pem");
  const keyPath = join(tempDir, "pass_key.pem");

  try {
    if (logger?.info) {
      logger.info(
        { cardId: String(card?._id), serialNumber: String(card?._id) },
        "[APPLE_WALLET] building pass"
      );
    }
    const p12Buffer = Buffer.from(cfg.passP12Base64, "base64");
    await writeFile(p12Path, p12Buffer);

    await execFileAsync("openssl", [
      "pkcs12",
      "-in",
      p12Path,
      "-clcerts",
      "-nokeys",
      "-out",
      certPath,
      "-passin",
      `pass:${cfg.passP12Password}`,
    ]);

    await execFileAsync("openssl", [
      "pkcs12",
      "-in",
      p12Path,
      "-nocerts",
      "-nodes",
      "-out",
      keyPath,
      "-passin",
      `pass:${cfg.passP12Password}`,
    ]);

    const passCertPem = await readFile(certPath);
    const passKeyPem = await readFile(keyPath);
    const wwdrPem = Buffer.from(cfg.wwdrPemBase64, "base64").toString("utf8");

    const logoText =
      String(
        card?.template?.header ||
          card?.template?.programName ||
          card?.header ||
          "Pluxeo"
      ).trim() || "Pluxeo";

    const backgroundColor =
      toRgbString(card?.template?.primaryColor) || "rgb(0,0,0)";

    const secondaryFields = [];

    if (Number.isFinite(publicPayload?.stamps)) {
      secondaryFields.push({
        key: "stamps",
        label: "Stamps",
        value: String(publicPayload.stamps),
      });
    }

    const backFields = buildBackFields({ card });

    const barcodeSelection = pickBarcodeWithSource({ publicPayload, walletToken });

    if (logger?.info) {
      logger.info(
        {
          source: barcodeSelection.source,
          maskedCode: maskRedeemCode(barcodeSelection.message),
        },
        "[APPLE_WALLET] barcode selected"
      );
    }

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: cfg.passTypeId,
      teamIdentifier: cfg.teamId,
      serialNumber: String(card._id),
      organizationName: "Pluxeo",
      description: "Pluxeo Wallet Pass",
      logoText,
      foregroundColor: "rgb(255,255,255)",
      backgroundColor,
      storeCard: {
        primaryFields: [{ key: "program", label: "Program", value: logoText }],
        ...(secondaryFields.length ? { secondaryFields } : {}),
        ...(backFields.length ? { backFields } : {}),
      },
      barcodes: [
        {
          format: "PKBarcodeFormatQR",
          message: barcodeSelection.message,
          messageEncoding: "iso-8859-1",
        },
      ],
    };

    const finalPassJson = customOverrides
      ? { ...passJson, ...customOverrides }
      : passJson;

    const assets = await loadDefaultAppleAssets();
    if (logger?.debug) {
      logger.debug(
        { assetFiles: Object.keys(assets) },
        "[APPLE_WALLET] assets loaded"
      );
    }

    const files = {
      "pass.json": Buffer.from(JSON.stringify(finalPassJson, null, 2)),
      "icon.png": assets["icon.png"],
      "logo.png": assets["logo.png"],
    };

    const manifestJsonBuffer = await buildManifest(files);
    if (logger?.debug) {
      logger.debug(
        { fileCount: Object.keys(files).length },
        "[APPLE_WALLET] manifest files count"
      );
    }
    const signature = await signManifestWithOpenSSL({
      manifestJsonBuffer,
      passCertPem,
      passKeyPem,
      wwdrPem,
      logger,
    });

    const filesWithSignature = {
      ...files,
      "manifest.json": manifestJsonBuffer,
      signature,
    };

    return await zipToBuffer(filesWithSignature, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

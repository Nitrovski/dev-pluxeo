import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getAppleWalletConfig } from "./appleWallet.config.js";
import { loadDefaultAppleAssets } from "./appleWallet.assets.js";
import { buildManifest, signManifestWithOpenSSL } from "./appleWallet.sign.js";

const execFileAsync = promisify(execFile);

function pickString(value, fallback = "") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeaderText(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

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

function buildBackFields({ template }) {
  const promoText = String(template?.promoText ?? "").trim();
  const detailsText = String(template?.detailsText ?? "").trim();
  const termsText = String(template?.termsText ?? "").trim();

  const fields = [];

  if (promoText) {
    fields.push({ key: "latest_news", label: "LATEST NEWS", value: promoText });
  }

  if (detailsText) {
    fields.push({ key: "how_to_use", label: "HOW TO USE", value: detailsText });
  }

  if (termsText) {
    fields.push({ key: "terms", label: "TERMS", value: termsText });
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

function normalizeAppleWallet(template) {
  const walletIn = isObj(template?.wallet) ? template.wallet : {};
  const appleIn = isObj(walletIn.apple) ? walletIn.apple : {};
  const googleIn = isObj(walletIn.google) ? walletIn.google : {};
  const colorsIn = isObj(appleIn.colors) ? appleIn.colors : {};
  const imagesIn = isObj(appleIn.images) ? appleIn.images : {};
  const layoutIn = isObj(appleIn.layout) ? appleIn.layout : {};

  const programName = pickString(template?.programName, "");
  const headline = pickString(template?.headline, "");
  const primaryColor = pickString(template?.primaryColor, "");
  const rootLogoUrl = pickString(template?.logoUrl, "");

  const googleHeaderText = normalizeHeaderText(googleIn.headerText);
  const googleIssuerName = pickString(googleIn.issuerName, "");
  const googleLogoUrl = pickString(googleIn.logoUrl, "");
  const googleBackgroundColor = pickString(googleIn.backgroundColor, "");

  const resolvedLogoText =
    pickString(appleIn.logoText, "") ||
    programName ||
    headline ||
    googleHeaderText ||
    "Pluxeo";
  const resolvedIssuerName = pickString(appleIn.issuerName, "") || googleIssuerName || "Pluxeo";

  const backgroundColor =
    pickString(colorsIn.backgroundColor, "") ||
    primaryColor ||
    googleBackgroundColor ||
    "#111827";
  const foregroundColor = pickString(colorsIn.foregroundColor, "") || "#FFFFFF";
  const labelColor = pickString(colorsIn.labelColor, "") || "#DDDDDD";

  const logoUrl = pickString(imagesIn.logoUrl, "") || rootLogoUrl || googleLogoUrl || "";
  const iconUrl = pickString(imagesIn.iconUrl, "") || logoUrl;
  const stripUrl = pickString(imagesIn.stripUrl, "") || "";

  const enabled = appleIn.enabled !== undefined ? Boolean(appleIn.enabled) : true;
  const style =
    appleIn.style === "generic" || appleIn.style === "storeCard" ? appleIn.style : "storeCard";
  const primaryFieldId = typeof layoutIn.primaryFieldId === "string" ? layoutIn.primaryFieldId : "";
  const primarySource =
    layoutIn.primarySource === "programName" ||
    layoutIn.primarySource === "none" ||
    layoutIn.primarySource === "header"
      ? layoutIn.primarySource
      : "header";

  const secondarySlotIds = Array.isArray(layoutIn.secondarySlotIds)
    ? layoutIn.secondarySlotIds.filter((slot) => typeof slot === "string")
    : ["stamps", "rewards"];
  const auxiliarySlotIds = Array.isArray(layoutIn.auxiliarySlotIds)
    ? layoutIn.auxiliarySlotIds.filter((slot) => typeof slot === "string")
    : ["websiteUrl", "openingHours", "tier", "email"];

  return {
    enabled,
    style,
    logoText: resolvedLogoText,
    issuerName: resolvedIssuerName,
    colors: {
      backgroundColor,
      foregroundColor,
      labelColor,
    },
    images: {
      logoUrl,
      iconUrl,
      stripUrl,
    },
    layout: {
      primaryFieldId,
      primarySource,
      secondarySlotIds,
      auxiliarySlotIds,
    },
  };
}

function truncateAppleText(value, maxLength = 40) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toHostname(value) {
  const safe = String(value || "").trim();
  if (!safe) return "";
  const stripped = safe.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return stripped.split("/")[0] || "";
}

function resolveAppleFieldValue(fieldId, { publicPayload, template }) {
  const trimmedId = String(fieldId || "").trim();
  if (!trimmedId) return null;

  switch (trimmedId) {
    case "stamps": {
      const stampsCount = Number(publicPayload?.stamps || 0);
      const freeStamps =
        Number(template?.freeStampsToReward || template?.rules?.freeStampsToReward || 0);
      if (!Number.isFinite(stampsCount)) return null;
      if (Number.isFinite(freeStamps) && freeStamps > 0) {
        return { label: "STAMPS", value: `${stampsCount}/${freeStamps}` };
      }
      return { label: "STAMPS", value: String(stampsCount) };
    }
    case "rewards": {
      const rewardsCount = Number(publicPayload?.rewards || 0);
      if (!Number.isFinite(rewardsCount)) return null;
      return { label: "REWARDS", value: String(rewardsCount) };
    }
    case "websiteUrl": {
      const hostname = toHostname(template?.websiteUrl);
      if (!hostname) return null;
      return { label: "WEB", value: hostname };
    }
    case "openingHours": {
      const value = String(template?.openingHours || "").trim();
      if (!value) return null;
      return { label: "HOURS", value };
    }
    case "customMessage": {
      const value = truncateAppleText(template?.customMessage);
      if (!value) return null;
      return { label: "MESSAGE", value };
    }
    case "promoText": {
      const value = truncateAppleText(template?.promoText);
      if (!value) return null;
      return { label: "NEWS", value };
    }
    default:
      return null;
  }
}

function resolveBarcodeFormat({ redeemFormat, barcodeType }) {
  const normalizedRedeem = String(redeemFormat || "").toLowerCase();
  const normalizedType = String(barcodeType || "").toLowerCase();

  if (normalizedRedeem === "qr") {
    return "PKBarcodeFormatQR";
  }

  if (normalizedRedeem === "code128" || normalizedType === "code128") {
    return "PKBarcodeFormatCode128";
  }

  return "PKBarcodeFormatQR";
}

function buildSlotField({ fieldId, field, fieldKeyPrefix }) {
  if (!field) return null;
  const trimmedValue = String(field.value || "").trim();
  if (!trimmedValue) return null;
  return {
    key: `${fieldKeyPrefix}_${fieldId}`,
    label: field.label,
    value: trimmedValue,
  };
}

async function fetchImageBuffer(url, logger) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return null;

  try {
    const response = await fetch(safeUrl);
    if (!response.ok) {
      logger?.warn?.({ status: response.status, url: safeUrl }, "[APPLE_WALLET] image fetch failed");
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger?.warn?.({ error: error?.message, url: safeUrl }, "[APPLE_WALLET] image fetch failed");
    return null;
  }
}

export async function buildApplePkpassBuffer({
  card,
  publicPayload,
  walletToken,
  template,
  merchant,
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

    const templateInput = template || {};
    const walletApple = normalizeAppleWallet(templateInput);
    const walletGoogle = isObj(templateInput.wallet?.google) ? templateInput.wallet.google : {};
    const programName = pickString(templateInput.programName, "");
    const headline = pickString(templateInput.headline, "");
    const subheadline = pickString(templateInput.subheadline, "");
    const merchantName = pickString(merchant?.name, "");

    const logoText = walletApple.logoText;

    const backgroundColor =
      toRgbString(walletApple.colors.backgroundColor) ||
      toRgbString(templateInput.primaryColor) ||
      toRgbString(walletGoogle.backgroundColor) ||
      "rgb(0,0,0)";
    const foregroundColor = toRgbString(walletApple.colors.foregroundColor) || "rgb(255,255,255)";
    const labelColor = toRgbString(walletApple.colors.labelColor) || "rgb(221,221,221)";

    const description =
      programName || headline || "Pluxeo Wallet Pass";
    const organizationName = walletApple.issuerName || "Pluxeo";

    const primaryFields = [];
    const secondaryFields = [];
    const auxiliaryFields = [];
    const usedFieldIds = new Set();

    if (walletApple.layout.primaryFieldId) {
      const resolvedPrimary = resolveAppleFieldValue(walletApple.layout.primaryFieldId, {
        template: templateInput,
        publicPayload,
      });
      const primaryField = buildSlotField({
        fieldId: walletApple.layout.primaryFieldId,
        field: resolvedPrimary,
        fieldKeyPrefix: "primary",
      });
      if (primaryField) {
        primaryFields.push(primaryField);
        usedFieldIds.add(walletApple.layout.primaryFieldId);
      }
    } else if (walletApple.layout.primarySource === "header") {
      const resolvedPrimary = resolveAppleFieldValue("stamps", {
        template: templateInput,
        publicPayload,
      });
      const primaryField = buildSlotField({
        fieldId: "stamps",
        field: resolvedPrimary,
        fieldKeyPrefix: "primary",
      });
      if (primaryField) {
        primaryFields.push(primaryField);
        usedFieldIds.add("stamps");
      }
    } else if (walletApple.layout.primarySource === "programName") {
      const programValue =
        programName || normalizeHeaderText(walletGoogle.headerText) || merchantName;
      if (programValue) {
        primaryFields.push({
          key: "primary_program",
          label: "PROGRAM",
          value: programValue,
        });
        usedFieldIds.add("programName");
      }
    }

    for (const slotId of walletApple.layout.secondarySlotIds) {
      if (usedFieldIds.has(slotId) || secondaryFields.length >= 2) continue;
      const resolvedField = resolveAppleFieldValue(slotId, {
        template: templateInput,
        publicPayload,
      });
      const field = buildSlotField({
        fieldId: slotId,
        field: resolvedField,
        fieldKeyPrefix: "secondary",
      });
      if (field) {
        secondaryFields.push(field);
        usedFieldIds.add(slotId);
      }
    }

    for (const slotId of walletApple.layout.auxiliarySlotIds) {
      if (usedFieldIds.has(slotId) || auxiliaryFields.length >= 2) continue;
      const resolvedField = resolveAppleFieldValue(slotId, {
        template: templateInput,
        publicPayload,
      });
      const field = buildSlotField({
        fieldId: slotId,
        field: resolvedField,
        fieldKeyPrefix: "aux",
      });
      if (field) {
        auxiliaryFields.push(field);
        usedFieldIds.add(slotId);
      }
    }

    const backFields = buildBackFields({ template: templateInput });

    const barcodeSelection = pickBarcodeWithSource({ publicPayload, walletToken });
    const barcodeFormat = resolveBarcodeFormat({
      redeemFormat: templateInput?.rules?.redeemFormat,
      barcodeType: templateInput?.rules?.barcodeType,
    });

    if (logger?.info) {
      logger.info(
        {
          source: barcodeSelection.source,
          maskedCode: maskRedeemCode(barcodeSelection.message),
        },
        "[APPLE_WALLET] barcode selected"
      );
    }

    const passTypeKey = walletApple.style === "generic" ? "generic" : "storeCard";
    const passTypeFields = {
      ...(primaryFields.length ? { primaryFields } : {}),
      ...(secondaryFields.length ? { secondaryFields } : {}),
      ...(auxiliaryFields.length ? { auxiliaryFields } : {}),
      ...(backFields.length ? { backFields } : {}),
    };

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: cfg.passTypeId,
      teamIdentifier: cfg.teamId,
      serialNumber: String(card._id),
      organizationName,
      description,
      logoText,
      foregroundColor,
      backgroundColor,
      labelColor,
      [passTypeKey]: passTypeFields,
      barcodes: [
        {
          format: barcodeFormat,
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

    const iconBuffer =
      (await fetchImageBuffer(walletApple.images.iconUrl, logger)) || assets["icon.png"];
    const logoBuffer =
      (await fetchImageBuffer(walletApple.images.logoUrl, logger)) || assets["logo.png"];
    const stripBuffer = await fetchImageBuffer(walletApple.images.stripUrl, logger);

    const files = {
      "pass.json": Buffer.from(JSON.stringify(finalPassJson, null, 2)),
      "icon.png": iconBuffer,
      "logo.png": logoBuffer,
    };
    if (stripBuffer) {
      files["strip.png"] = stripBuffer;
    }

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

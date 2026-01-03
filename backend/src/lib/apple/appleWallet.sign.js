import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function buildManifest(filesMap) {
  const manifest = {};

  for (const [filename, buffer] of Object.entries(filesMap)) {
    if (filename === "manifest.json" || filename === "signature") {
      continue;
    }

    const hash = createHash("sha1").update(buffer).digest("hex");
    manifest[filename] = hash;
  }

  return Buffer.from(JSON.stringify(manifest, null, 2));
}

export async function signManifestWithOpenSSL({
  manifestJsonBuffer,
  passCertPem,
  passKeyPem,
  wwdrPem,
  logger,
}) {
  const tempDir = await mkdtemp(join(tmpdir(), "apple-wallet-sign-"));
  const manifestPath = join(tempDir, "manifest.json");
  const certPath = join(tempDir, "pass_cert.pem");
  const keyPath = join(tempDir, "pass_key.pem");
  const wwdrPath = join(tempDir, "wwdr.pem");
  const signaturePath = join(tempDir, "signature");

  try {
    if (logger?.info) {
      logger.info("[APPLE_WALLET] signing manifest");
    }
    await writeFile(manifestPath, manifestJsonBuffer);
    await writeFile(certPath, passCertPem);
    await writeFile(keyPath, passKeyPem);
    await writeFile(wwdrPath, wwdrPem);

    try {
      await execFileAsync("openssl", [
        "smime",
        "-binary",
        "-sign",
        "-certfile",
        wwdrPath,
        "-signer",
        certPath,
        "-inkey",
        keyPath,
        "-in",
        manifestPath,
        "-out",
        signaturePath,
        "-outform",
        "DER",
        "-nodetach",
      ]);
    } catch (err) {
      if (logger?.error) {
        logger.error(
          {
            error: err?.message,
            stdout: err?.stdout,
            stderr: err?.stderr,
          },
          "[APPLE_WALLET] openssl signing failed"
        );
      }
      throw err;
    }

    return await readFile(signaturePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

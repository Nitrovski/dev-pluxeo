import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client } from "./r2Client.js";

const allowedMimeTypes = ["image/png", "image/jpeg", "image/svg+xml"];
const kindToExtension = {
  logo: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
  },
  hero: {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
  },
};

function buildPublicUrl({ baseUrl, bucketName, key }) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const k = String(key || "").replace(/^\/+/, "");
  if (!base) throw new Error("Missing R2_PUBLIC_BASE_URL");

  // r2.dev → bucket je v hostname, nepatří do path
  if (base.includes(".r2.dev")) return `${base}/${k}`;

  // fallback pro S3-style endpointy
  const b = String(bucketName || "").replace(/^\/+|\/+$/g, "");
  if (!b) throw new Error("Missing R2_BUCKET_NAME");
  return `${base}/${b}/${k}`;
}

export const uploadMerchantAsset = async ({
  merchantId,
  kind,
  buffer,
  contentType,
}) => {
  if (!kindToExtension[kind]) {
    throw new Error("Invalid kind. Use logo or hero.");
  }

  if (!allowedMimeTypes.includes(contentType)) {
    throw new Error("Unsupported file type. Use PNG, JPEG, or SVG.");
  }

  const ext = kindToExtension[kind][contentType];

  // Produkční řešení: verzované názvy → žádné cache problémy
  const version = Date.now(); // alternativně UUID/hash, ale timestamp stačí
  const key = `merchants/${merchantId}/${kind}-${version}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  await r2Client.send(command);

  return buildPublicUrl({
    baseUrl: process.env.R2_PUBLIC_BASE_URL,
    bucketName: process.env.R2_BUCKET_NAME,
    key,
  });
};

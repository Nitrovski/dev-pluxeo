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
  const key = `merchants/${merchantId}/${kind}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  });

  await r2Client.send(command);

  return `${process.env.R2_PUBLIC_BASE_URL}/${process.env.R2_BUCKET_NAME}/${key}`;
};

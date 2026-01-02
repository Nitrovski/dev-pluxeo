import {
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
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

// Kolik verzí chceme ponechat (doporučuju 3–5)
const KEEP_LATEST_VERSIONS = Number(process.env.R2_ASSET_KEEP_LATEST || 3);

function buildPublicUrl({ baseUrl, bucketName, key }) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const k = String(key || "").replace(/^\/+/, "");
  if (!base) throw new Error("Missing R2_PUBLIC_BASE_URL");

  if (base.includes(".r2.dev")) return `${base}/${k}`;

  const b = String(bucketName || "").replace(/^\/+|\/+$/g, "");
  if (!b) throw new Error("Missing R2_BUCKET_NAME");
  return `${base}/${b}/${k}`;
}

function extractTimestampFromKey(key, kind) {
  // očekáváme: merchants/<merchantId>/<kind>-<ts>.<ext>
  // vrátí číslo nebo 0
  const re = new RegExp(`${kind}-(\\d+)\\.`);
  const m = String(key || "").match(re);
  return m ? Number(m[1]) : 0;
}

async function cleanupOldAssets({ merchantId, kind, keepLatest }) {
  // prefix: merchants/<merchantId>/logo-
  const prefix = `merchants/${merchantId}/${kind}-`;

  const list = await r2Client.send(
    new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: prefix,
      // MaxKeys můžeš zvýšit, ale reálně to budou desítky
      MaxKeys: 1000,
    })
  );

  const items = (list.Contents || [])
    .map((x) => x.Key)
    .filter(Boolean);

  if (items.length <= keepLatest) return;

  // seřadit podle timestampu v key (nejnovější první)
  const sorted = items.sort((a, b) => {
    const ta = extractTimestampFromKey(a, kind);
    const tb = extractTimestampFromKey(b, kind);
    return tb - ta;
  });

  const toDelete = sorted.slice(keepLatest);

  // bezpečnost: nemaž nic, co neodpovídá prefixu
  const safeToDelete = toDelete.filter((k) => String(k).startsWith(prefix));
  if (!safeToDelete.length) return;

  await r2Client.send(
    new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: {
        Objects: safeToDelete.map((Key) => ({ Key })),
        Quiet: true,
      },
    })
  );
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
  const version = Date.now();
  const key = `merchants/${merchantId}/${kind}-${version}.${ext}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  // Cleanup starých verzí (neblokuj tvrdě upload, když cleanup selže)
  try {
    await cleanupOldAssets({
      merchantId,
      kind,
      keepLatest: Math.max(1, KEEP_LATEST_VERSIONS),
    });
  } catch (e) {
    // nechceme kvůli úklidu failnout upload
    // případně logni přes fastify logger v route (tam je lepší kontext)
    // console.warn("cleanupOldAssets failed:", e);
  }

  return buildPublicUrl({
    baseUrl: process.env.R2_PUBLIC_BASE_URL,
    bucketName: process.env.R2_BUCKET_NAME,
    key,
  });
};

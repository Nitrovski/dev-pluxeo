import { googleWalletConfig } from "../config/googleWallet.config.js";
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";
import jwt from "jsonwebtoken";
import {
  isGoogleWalletBadRequest,
  walletRequest,
} from "./googleWalletClient.js";
import { loadGoogleWalletServiceAccount } from "./googleWalletAuth.js";
import { makeClassId, makeObjectId } from "./googleWalletIds.js";

const DEFAULT_PROGRAM_NAME = "Pluxeo";
const DEFAULT_PRIMARY_COLOR = "#FF9900";
const DEV_DEFAULT_LOGO_URL =
  "https://storage.googleapis.com/wallet-lab-tools-codelab-artifacts/LoyaltyClass/loyalty_class_logo.png";
const MAX_TEXT_MODULES = 4;
const PROMO_MAX_LENGTH = 60;
const GENERIC_PROMO_MAX_LENGTH = 40;
const MAX_BARCODE_LENGTH = 120;
const FALLBACK_IMAGE_URL = "https://www.pluxeo.com/logo.png";
const GENERIC_CLASS_PREFIX_SUFFIX = "_generic";

function normBarcodeValue(v) {
  return String(v ?? "")
    .trim()
    .replace(/[\r\n\t ]+/g, "");
}

function isValidHttpsUrl(url) {
  return typeof url === "string" && url.trim().toLowerCase().startsWith("https://");
}

function sanitizeImageUrl(url) {
  const original = url ?? "";
  const sanitized = String(original).trim().replace(/^['"]+|['"]+$/g, "").trim();

  return { original, sanitized };
}

function normalizePluxeoHostname(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === "pluxeo.com") {
      parsed.hostname = "www.pluxeo.com";
    }

    return parsed.toString();
  } catch (_err) {
    return url;
  }
}

function normalizeImageUrl(url) {
  const { original, sanitized } = sanitizeImageUrl(url);
  const normalized = normalizePluxeoHostname(sanitized);

  return { original, normalized };
}

async function validateImageUrlOrFallback(url) {
  const normalized = normalizePluxeoHostname(url);
  const isCandidateValid =
    isValidHttpsUrl(normalized) && !containsQuoteCharacters(normalized);

  const candidate = isCandidateValid ? normalized : FALLBACK_IMAGE_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const isImageResponse = (response) => {
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    return response.ok && contentType.startsWith("image/");
  };

  try {
    let response = await fetch(candidate, {
      method: "HEAD",
      signal: controller.signal,
    });

    if (!isImageResponse(response)) {
      response = await fetch(candidate, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
      });
    }

    if (isImageResponse(response)) {
      return candidate;
    }
  } catch (_err) {
    // Best-effort validation: fall through to fallback on any errors (including timeouts).
  } finally {
    clearTimeout(timeout);
  }

  return FALLBACK_IMAGE_URL;
}

function containsQuoteCharacters(str) {
  return str.includes("'") || str.includes('"');
}

function resolveDefaultLogoUrl() {
  const envLogoUrl = googleWalletConfig.defaultLogoUrl;

  if (isValidHttpsUrl(envLogoUrl)) {
    return envLogoUrl.trim();
  }

  if (envLogoUrl) {
    console.warn(
      "GOOGLE_WALLET_DEFAULT_LOGO_URL must start with https://. Ignoring invalid value."
    );
  }

  if (googleWalletConfig.isDevEnv) {
    return DEV_DEFAULT_LOGO_URL;
  }

  const errorMessage =
    "Missing valid default Google Wallet logo URL. Set GOOGLE_WALLET_DEFAULT_LOGO_URL to an https:// URL.";
  console.error(errorMessage);
  const error = new Error(errorMessage);
  error.statusCode = 500;
  throw error;
}

function sanitizeTextModules(textModules) {
  if (!Array.isArray(textModules)) return [];

  return textModules
    .map((tm) => ({
      header: (tm?.header || "").trim(),
      body: (tm?.body || "").trim(),
    }))
    .filter((tm) => tm.header && tm.body)
    .slice(0, MAX_TEXT_MODULES);
}

function sanitizePromoText(rawPromoText) {
  const collapsed = String(rawPromoText ?? "").replace(/\s+/g, " ").trim();

  const promoText = collapsed
    ? collapsed.length > PROMO_MAX_LENGTH
      ? `${collapsed.slice(0, PROMO_MAX_LENGTH - 1).trimEnd()}…`
      : collapsed
    : "";

  console.log("GW_PROMO", {
    promoText: promoText || null,
    promoLen: promoText?.length,
  });

  return promoText || null;
}

function sanitizeGenericPromoText(rawPromoText) {
  const collapsed = String(rawPromoText ?? "").replace(/\s+/g, " ").trim();

  if (!collapsed) return null;

  if (collapsed.length > GENERIC_PROMO_MAX_LENGTH) {
    return `${collapsed.slice(0, GENERIC_PROMO_MAX_LENGTH - 1).trimEnd()}…`;
  }

  return collapsed;
}

function sanitizeLinks(links) {
  if (!Array.isArray(links)) return [];

  return links
    .map((link) => ({
      uri: (link?.uri || "").trim(),
      description: (link?.description || "").trim(),
      label: (link?.label || "").trim(),
    }))
    .filter((link) => isValidHttpsUrl(link.uri))
    .filter((link) => link.description || link.label);
}

function trimTextModuleValue(value) {
  return String(value ?? "").trim();
}

function compactTextModulesData(textModulesData) {
  if (!Array.isArray(textModulesData)) return [];

  return textModulesData
    .map((module) => {
      const header = trimTextModuleValue(module?.header);
      const body = trimTextModuleValue(module?.body);

      return { ...(module || {}), header, body };
    })
    // Google Wallet rejects textModulesData entries without a header ("header must be set").
    .filter((module) => module.header && module.body)
    .slice(0, MAX_TEXT_MODULES);
}

function normalizeLinksModuleData(linksModuleData) {
  if (!linksModuleData?.uris?.length) return null;

  const sanitizedUris = sanitizeLinks(linksModuleData.uris).map((link, idx) => ({
    uri: link.uri,
    description: link.label || link.description || `Otevřít odkaz ${idx + 1}`,
  }));

  return sanitizedUris.length > 0 ? { uris: sanitizedUris } : null;
}

function logInvalidResourcePayload({ err, label, payload }) {
  const errorMessage = err?.responseBody?.error?.message || "";
  const isInvalidResource =
    isGoogleWalletBadRequest(err) && errorMessage.includes("invalidResource");

  if (!googleWalletConfig.isDevEnv || !isInvalidResource) return;

  const serialized = JSON.stringify(payload ?? {});

  console.warn("GW_INVALID_RESOURCE_PAYLOAD", {
    label,
    message: errorMessage,
    payloadPreview: serialized.slice(0, 1500),
  });
}

function normalizeWebsiteUrl(websiteUrl) {
  const raw = String(websiteUrl ?? "").trim();
  if (!raw) return null;

  const prefixed = raw.match(/^https?:\/\//i) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(prefixed);

    if (parsed.protocol !== "https:") {
      parsed.protocol = "https:";
    }

    return parsed.toString();
  } catch (_err) {
    return null;
  }
}

function resolveHeaderText({ template, customer }) {
  const templateHeader = String(template?.wallet?.google?.headerText ?? "").trim();
  if (templateHeader) return templateHeader;

  const customerName = String(customer?.name ?? "").trim();
  if (customerName) return customerName;

  return DEFAULT_PROGRAM_NAME;
}

function buildTemplateTextModulesData(template) {
  const modules = [];
  const promoText = sanitizePromoText(template?.promoText);
  const promoPresent = Boolean(promoText);

  if (promoPresent) {
    modules.push({ id: "promo", header: "AKCE", body: promoText });
  }

  const walletGoogle = template?.wallet?.google || {};
  const sanitizedTemplateModules = sanitizeTextModules(walletGoogle.textModules);

  sanitizedTemplateModules.forEach((module, idx) => {
    modules.push({ id: `tpl_${idx}`, header: module.header, body: module.body });
  });

  const detailModules = [];
  const pushDetailModule = (value, id, header) => {
    const body = String(value ?? "").trim();
    if (body) detailModules.push({ id, header, body });
  };

  pushDetailModule(template?.openingHours, "detail_opening_hours", "Otevírací doba");
  pushDetailModule(template?.customMessage, "detail_custom_message", "Zpráva");

  const headline = String(template?.headline || "").trim();
  const subheadline = String(template?.subheadline || "").trim();

  if (headline) detailModules.push({ id: "detail_info_headline", header: "Info", body: headline });
  if (subheadline)
    detailModules.push({ id: "detail_info_subheadline", header: "Info", body: subheadline });

  modules.push(...detailModules);

  return {
    modules,
    promoPresent,
    templateTextModuleCount: modules.length,
  };
}

function buildTextModuleTemplate(index) {
  return {
    firstValue: {
      fields: [{ fieldPath: `object.textModulesData[${index}].header` }],
    },
    secondValue: {
      fields: [{ fieldPath: `object.textModulesData[${index}].body` }],
    },
  };
}

function buildGenericClassTemplateInfo(fieldCount = 0) {
  const rows = [];
  const normalizedCount = Math.max(1, fieldCount);

  for (let idx = 0; idx < normalizedCount; idx += 2) {
    const startIndex = idx;
    const endIndex = idx + 1;

    rows.push({
      twoItems: {
        startItem: buildTextModuleTemplate(startIndex),
        endItem: buildTextModuleTemplate(endIndex),
      },
    });
  }

  return {
    cardTemplateOverride: {
      cardBarcodeSectionDetails: {
        renderedBarcodes: [
          {
            templateItem: {
              firstValue: { fields: [{ fieldPath: "object.barcode" }] },
            },
            showCodeText: true,
          },
        ],
      },
      cardRowTemplateInfos: rows,
    },
  };
}

function buildClassTemplateInfo({ templateTextModuleCount, promoPresent = false }) {
  const rows = [];
  const dynamicIndexStart = Math.max(0, templateTextModuleCount);
  const dynamicTextRowIndices = [dynamicIndexStart, dynamicIndexStart + 1];
  const promoIndex = promoPresent ? 0 : null;

  rows.push({
    twoItems: {
      startItem: {
        firstValue: { fields: [{ fieldPath: "object.loyaltyPoints.label" }] },
        secondValue: { fields: [{ fieldPath: "object.loyaltyPoints.balance" }] },
      },
      endItem: {
        firstValue: {
          fields: [{ fieldPath: "object.secondaryLoyaltyPoints.label" }],
        },
        secondValue: {
          fields: [{ fieldPath: "object.secondaryLoyaltyPoints.balance" }],
        },
      },
    },
  });

  if (promoPresent) {
    const promoRowEndIndex =
      templateTextModuleCount > 1 && promoIndex === 0
        ? 1
        : dynamicTextRowIndices[0];

    rows.push({
      twoItems: {
        startItem: buildTextModuleTemplate(promoIndex),
        endItem: buildTextModuleTemplate(promoRowEndIndex),
      },
    });
  }

  rows.push({
    twoItems: {
      startItem: buildTextModuleTemplate(dynamicTextRowIndices[0]),
      endItem: buildTextModuleTemplate(dynamicTextRowIndices[1]),
    },
  });

  const contentStartIndex = promoPresent ? 1 : 0;
  const remainingTemplateCount = Math.max(
    0,
    templateTextModuleCount - contentStartIndex
  );

  if (remainingTemplateCount > 0) {
    const templateIndices = [contentStartIndex, contentStartIndex + 1].map((idx) =>
      idx < templateTextModuleCount ? idx : dynamicIndexStart
    );

    rows.push({
      twoItems: {
        startItem: buildTextModuleTemplate(templateIndices[0]),
        endItem: buildTextModuleTemplate(templateIndices[1]),
      },
    });
  }

  return {
    cardTemplateOverride: {
      cardBarcodeSectionDetails: {
        renderedBarcodes: [
          {
            templateItem: {
              firstValue: { fields: [{ fieldPath: "object.barcode" }] },
            },
            showCodeText: true,
          },
        ],
      },
      cardRowTemplateInfos: rows,
    },
  };
}

function buildObjectTextModules({ template, card }) {
  const templateModulesData = buildTemplateTextModulesData(template);

  const dynamicModules = [
    {
      id: "dyn_stamps",
      header: "Razítka",
      body: String(card?.stamps ?? 0),
    },
    {
      id: "dyn_rewards",
      header: "Odměny",
      body: String(card?.rewards ?? 0),
    },
  ];

  return {
    textModules: [...templateModulesData.modules, ...dynamicModules],
    templateTextModuleCount: templateModulesData.templateTextModuleCount,
    promoPresent: templateModulesData.promoPresent,
  };
}

function buildObjectLinksModuleData(template) {
  const walletGoogle = template?.wallet?.google || {};
  const uris = [];

  const normalizedWebsite = normalizeWebsiteUrl(template?.websiteUrl);
  if (normalizedWebsite) {
    uris.push({ uri: normalizedWebsite, description: "Web" });
  }

  const linksModuleUris = sanitizeLinks(walletGoogle.links).map((link, idx) => ({
    uri: link.uri,
    description: link.label || link.description || `Otevřít odkaz ${idx + 1}`,
  }));

  uris.push(...linksModuleUris);

  return uris.length > 0 ? { uris } : null;
}

function buildGenericFrontFields({ card, template }) {
  const cfg = template?.wallet?.google?.genericConfig || {};
  const fields = [];

  if (cfg.showPromo) {
    const promoText = sanitizeGenericPromoText(template?.promoText);
    if (promoText) {
      fields.push({ id: "promo", header: "AKCE", body: promoText });
    }
  }

  if (cfg.showStampsModule) {
    fields.push({ id: "stamps", header: "Razítka", body: String(card?.stamps ?? 0) });
    fields.push({ id: "rewards", header: "Odměny", body: String(card?.rewards ?? 0) });
  }

  if (cfg.showWebsite && template?.websiteUrl) {
    const normalizedWebsite = normalizeWebsiteUrl(template?.websiteUrl) || String(template?.websiteUrl).trim();
    if (normalizedWebsite) {
      fields.push({ id: "website", header: "Web", body: normalizedWebsite });
    }
  }

  if (cfg.showOpeningHours && template?.openingHours) {
    const openingHours = String(template?.openingHours || "").trim();
    if (openingHours) {
      fields.push({ id: "opening_hours", header: "Otevírací doba", body: openingHours });
    }
  }

  if (cfg.showEmail && (template?.email || template?.contactEmail)) {
    const email = String(template?.email || template?.contactEmail || "").trim();
    if (email) {
      fields.push({ id: "email", header: "Email", body: email });
    }
  }

  if (cfg.showTier) {
    const tierValue = String(card?.tier || card?.level || template?.tier || "").trim();
    if (tierValue) {
      fields.push({ id: "tier", header: "Tier", body: tierValue });
    }
  }

  return fields;
}

function estimateGenericFieldCount(template) {
  const cfg = template?.wallet?.google?.genericConfig || {};
  let count = 0;

  if (cfg.showPromo && sanitizeGenericPromoText(template?.promoText)) {
    count += 1;
  }

  if (cfg.showStampsModule) {
    count += 2;
  }

  if (cfg.showWebsite && normalizeWebsiteUrl(template?.websiteUrl)) {
    count += 1;
  }

  if (cfg.showOpeningHours && String(template?.openingHours || "").trim()) {
    count += 1;
  }

  if (cfg.showEmail && String(template?.email || template?.contactEmail || "").trim()) {
    count += 1;
  }

  if (cfg.showTier) {
    count += 1;
  }

  return Math.max(1, count);
}

async function buildGenericClassPayload({ classId, customer, template }) {
  const walletGoogle = template?.wallet?.google || {};
  const issuerName =
    (walletGoogle.issuerName || customer?.name || "").trim() || DEFAULT_PROGRAM_NAME;
  const programName =
    (walletGoogle.programName || template?.programName || customer?.name || "")
      .trim() || DEFAULT_PROGRAM_NAME;
  const primaryColor =
    walletGoogle.backgroundColor?.trim() ||
    template?.primaryColor?.trim() ||
    DEFAULT_PRIMARY_COLOR;

  const { original: logoUrlOriginal, normalized: logoUrlCandidate } = normalizeImageUrl(
    walletGoogle.logoUrl
  );
  const { original: heroImageOriginal, normalized: heroImageCandidate } = normalizeImageUrl(
    walletGoogle.heroImageUrl
  );

  const isLogoCandidateValid =
    isValidHttpsUrl(logoUrlCandidate) && !containsQuoteCharacters(logoUrlCandidate);

  if (!isLogoCandidateValid && (logoUrlOriginal || logoUrlCandidate)) {
    console.warn("GW_IMAGE_SANITIZED", {
      field: "logoUrl",
      original: logoUrlOriginal,
      sanitized: logoUrlCandidate,
    });
  }

  if (heroImageOriginal || heroImageCandidate) {
    console.warn("GW_IMAGE_SANITIZED", {
      field: "heroImageUrl",
      original: heroImageOriginal,
      sanitized: heroImageCandidate,
    });
  }

  const logoUrl = await validateImageUrlOrFallback(
    isLogoCandidateValid ? logoUrlCandidate : resolveDefaultLogoUrl()
  );
  const heroImageUrl = await validateImageUrlOrFallback(heroImageCandidate);

  const classTemplateInfo = buildGenericClassTemplateInfo(
    estimateGenericFieldCount(template)
  );

  const payload = {
    id: classId,
    issuerName,
    reviewStatus: "UNDER_REVIEW",
    logo: {
      sourceUri: { uri: logoUrl },
    },
    hexBackgroundColor: primaryColor,
    classTemplateInfo,
  };

  if (heroImageUrl) {
    payload.heroImage = { sourceUri: { uri: heroImageUrl } };
  }

  payload.cardTitle = {
    defaultValue: { language: "cs", value: programName },
  };

  return payload;
}

function buildGenericObjectPayload({
  objectId,
  classId,
  barcodeValue,
  textModulesData,
  template,
  customer,
}) {
  const normalizedBarcodeValue = normBarcodeValue(barcodeValue).slice(0, MAX_BARCODE_LENGTH);

  const walletGoogle = template?.wallet?.google || {};
  const programName =
    (walletGoogle.programName || template?.programName || "").trim() || DEFAULT_PROGRAM_NAME;
  const subheadline = String(template?.subheadline || "").trim();
  const headerText = resolveHeaderText({ template, customer });

  const payload = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: {
      defaultValue: { language: "cs", value: programName },
    },
    header: {
      defaultValue: { language: "cs", value: headerText },
    },
  };

  if (subheadline) {
    payload.subheader = { defaultValue: { language: "cs", value: subheadline } };
  }

  if (normalizedBarcodeValue) {
    payload.barcode = {
      type: "QR_CODE",
      value: normalizedBarcodeValue,
      alternateText: "Pluxeo",
    };
  }

  const sanitizedTextModules = compactTextModulesData(textModulesData);

  if (sanitizedTextModules.length > 0) {
    payload.textModulesData = sanitizedTextModules;
  }

  return payload;
}

function extractClassDebugFields(loyaltyClass) {
  const templateOverride = loyaltyClass?.classTemplateInfo?.cardTemplateOverride;
  const rowCount = Array.isArray(templateOverride?.cardRowTemplateInfos)
    ? templateOverride.cardRowTemplateInfos.length
    : 0;
  const renderedBarcodeCount = Array.isArray(
    templateOverride?.cardBarcodeSectionDetails?.renderedBarcodes
  )
    ? templateOverride.cardBarcodeSectionDetails.renderedBarcodes.length
    : 0;

  return {
    issuerName: loyaltyClass.issuerName,
    programName: loyaltyClass.programName,
    hexBackgroundColor: loyaltyClass.hexBackgroundColor,
    programLogoUrl: loyaltyClass?.programLogo?.sourceUri?.uri,
    heroImageUrl: loyaltyClass?.heroImage?.sourceUri?.uri || null,
    templateRows: rowCount,
    renderedBarcodes: renderedBarcodeCount,
  };
}

async function buildLoyaltyClassPayload({ classId, customer, template }) {
  const walletGoogle = template?.wallet?.google || {};
  const issuerName =
    (walletGoogle.issuerName || customer?.name || "").trim() ||
    DEFAULT_PROGRAM_NAME;
  const programName =
    (walletGoogle.programName || template?.programName || customer?.name || "")
      .trim() || DEFAULT_PROGRAM_NAME;
  const primaryColor =
    walletGoogle.backgroundColor?.trim() ||
    template?.primaryColor?.trim() ||
    DEFAULT_PRIMARY_COLOR;
  const { original: logoUrlOriginal, normalized: logoUrlCandidate } = normalizeImageUrl(
    walletGoogle.logoUrl
  );
  const { original: heroImageOriginal, normalized: heroImageCandidate } = normalizeImageUrl(
    walletGoogle.heroImageUrl
  );
  const isLogoCandidateValid =
    isValidHttpsUrl(logoUrlCandidate) && !containsQuoteCharacters(logoUrlCandidate);
  const templateTextModulesData = buildTemplateTextModulesData(template);
  const classTemplateInfo = buildClassTemplateInfo({
    templateTextModuleCount: templateTextModulesData.templateTextModuleCount,
    promoPresent: templateTextModulesData.promoPresent,
  });

  if (!isLogoCandidateValid && (logoUrlOriginal || logoUrlCandidate)) {
    console.warn("GW_IMAGE_SANITIZED", {
      field: "logoUrl",
      original: logoUrlOriginal,
      sanitized: logoUrlCandidate,
    });
  }

  if (heroImageOriginal || heroImageCandidate) {
    console.warn("GW_IMAGE_SANITIZED", {
      field: "heroImageUrl",
      original: heroImageOriginal,
      sanitized: heroImageCandidate,
    });
  }

  const logoUrl = await validateImageUrlOrFallback(
    isLogoCandidateValid ? logoUrlCandidate : resolveDefaultLogoUrl()
  );
  const heroImageUrl = await validateImageUrlOrFallback(heroImageCandidate);

  const payload = {
    id: classId,
    issuerName,
    programName,
    reviewStatus: "UNDER_REVIEW",
    programLogo: {
      sourceUri: { uri: logoUrl },
    },
    hexBackgroundColor: primaryColor,
    classTemplateInfo,
  };

  if (heroImageUrl) {
    payload.heroImage = {
      sourceUri: { uri: heroImageUrl },
    };
  }

  if (googleWalletConfig.isDevEnv) {
    console.log("WALLET_CLASS_SOURCE", {
      source: "template.wallet.google",
      logoUrl,
      bgColor: primaryColor,
      programName,
    });
  }

  return payload;
}

function persistClassId(customer, classId) {
  customer.settings = customer.settings || {};
  customer.settings.googleWallet = customer.settings.googleWallet || {};
  customer.settings.googleWallet.classId = classId;
  return customer.save();
}

async function resolveLoyaltyObjectBarcode({ card, cardId }) {
  const cardDoc = card || (await Card.findById(cardId));
  const redeemCodes = Array.isArray(cardDoc?.redeemCodes)
    ? cardDoc.redeemCodes.filter(Boolean)
    : [];

  const activeRedeem =
    redeemCodes.find((x) => x?.status === "active" && x?.purpose === "reward") ||
    redeemCodes.find((x) => x?.status === "active" && x?.purpose === "coupon") ||
    null;

  const qrMode = activeRedeem ? "redeem" : "stamp";
  const rawValue =
    qrMode === "redeem"
      ? `PXR:${activeRedeem?.code ?? ""}`
      : `PXS:${cardDoc?.walletToken ?? ""}`;

  const qrValue = String(rawValue)
    .trim()
    .replace(/[\r\n\t ]+/g, "")
    .slice(0, MAX_BARCODE_LENGTH);

  console.log("WALLET_QR_VALUE", { qrValue });

  return qrValue;
}

function buildLoyaltyObjectPayload({
  objectId,
  classId,
  card,
  barcodeValue,
  textModulesData,
  linksModuleData,
}) {
  const normalizedBarcodeValue = normBarcodeValue(barcodeValue).slice(
    0,
    MAX_BARCODE_LENGTH
  );

  const payload = {
    id: objectId,
    classId,
    state: "ACTIVE",
    accountId: String(card?._id || ""),
    accountName: "Pluxeo karta",
    loyaltyPoints: {
      label: "Razítka",
      balance: { int: card?.stamps ?? 0 },
    },
    secondaryLoyaltyPoints: {
      label: "Odměny",
      balance: { int: card?.rewards ?? 0 },
    },
  };

  if (normalizedBarcodeValue) {
    payload.barcode = {
      type: "QR_CODE",
      value: normalizedBarcodeValue,
      alternateText: "Pluxeo",
    };
  }

  const sanitizedTextModules = compactTextModulesData(textModulesData);

  if (sanitizedTextModules.length > 0) {
    payload.textModulesData = sanitizedTextModules;
  }

  const sanitizedLinksModule = normalizeLinksModuleData(linksModuleData);

  if (sanitizedLinksModule) {
    payload.linksModuleData = sanitizedLinksModule;
  }

  return payload;
}

export async function ensureLoyaltyClassForMerchant({
  merchantId,
  forcePatch = false,
  template,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  const customer = await Customer.findOne({ merchantId });
  if (!customer) {
    throw new Error("Customer not found for this merchant");
  }

  const templateDoc =
    template || (await CardTemplate.findOne({ merchantId }).lean());

  const classId = makeClassId({
    issuerId: googleWalletConfig.issuerId,
    classPrefix: googleWalletConfig.classPrefix,
    merchantId,
  });

  const loyaltyClass = await buildLoyaltyClassPayload({
    classId,
    customer,
    template: templateDoc,
  });

  console.log("GW_CLASS_UPSERT", {
    classId,
    hasTemplateInfo: Boolean(
      loyaltyClass.classTemplateInfo || loyaltyClass.cardTemplateInfo
    ),
  });

  let existed = false;

  const handleWalletError = (err, payload) => {
    if (isGoogleWalletBadRequest(err) && googleWalletConfig.isDevEnv) {
      console.warn(
        "GW_CLASS_SYNC_ERROR",
        classId,
        err?.responseBody?.error?.message
      );
    }

    logInvalidResourcePayload({
      err,
      label: "loyaltyClass",
      payload,
    });

    throw err;
  };

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/loyaltyClass/${classId}`,
    });
    existed = true;

    if (forcePatch) {
      if (googleWalletConfig.isDevEnv) {
        console.log("GOOGLE_WALLET_CLASS_PATCH_PAYLOAD", {
          classId,
          existed,
          fields: extractClassDebugFields(loyaltyClass),
        });
      }

      try {
        await walletRequest({
          method: "PATCH",
          path: `/walletobjects/v1/loyaltyClass/${classId}`,
          body: loyaltyClass,
        });
      } catch (err) {
        handleWalletError(err, loyaltyClass);
      }
    }
  } catch (err) {
    if (err?.status !== 404) {
      handleWalletError(err, loyaltyClass);
    }

    if (googleWalletConfig.isDevEnv) {
      console.log("GOOGLE_WALLET_CLASS_CREATE_PAYLOAD", {
        classId,
        existed,
        fields: extractClassDebugFields(loyaltyClass),
      });
    }

    try {
      await walletRequest({
        method: "POST",
        path: "/walletobjects/v1/loyaltyClass",
        body: loyaltyClass,
      });
    } catch (createErr) {
      handleWalletError(createErr, loyaltyClass);
    }
  }

  if (googleWalletConfig.isDevEnv) {
    try {
      const saved = await walletRequest({
        method: "GET",
        path: `/walletobjects/v1/loyaltyClass/${classId}`,
      });

      console.log("GOOGLE_WALLET_CLASS_SAVED_STATE", {
        classId,
        existed,
        fields: extractClassDebugFields(saved || {}),
      });
    } catch (verificationErr) {
      console.warn("GOOGLE_WALLET_CLASS_VERIFY_FAILED", {
        classId,
        error: verificationErr?.message,
      });
    }
  }

  await persistClassId(customer, classId);

  return { classId, existed };
}

export async function ensureLoyaltyObjectForCard({
  merchantId,
  cardId,
  forcePatch = false,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  if (!cardId) {
    throw new Error("cardId is required");
  }

  const cardDoc = await Card.findById(cardId);
  if (!cardDoc) {
    throw new Error("Card not found");
  }

  if (String(cardDoc.merchantId) !== String(merchantId)) {
    throw new Error("Card does not belong to merchant");
  }

  const template = await CardTemplate.findOne({ merchantId }).lean();

  const { classId } = await ensureLoyaltyClassForMerchant({
    merchantId,
    forcePatch,
    template,
  });

  const objectId = makeObjectId({
    issuerId: googleWalletConfig.issuerId,
    cardId,
  });

  const barcodeValue = await resolveLoyaltyObjectBarcode({ card: cardDoc, cardId });
  const { textModules } = buildObjectTextModules({
    template,
    card: cardDoc,
  });
  const linksModuleData = buildObjectLinksModuleData(template);

  const loyaltyObjectPayload = buildLoyaltyObjectPayload({
    objectId,
    classId,
    card: cardDoc,
    barcodeValue,
    textModulesData: textModules,
    linksModuleData,
  });

  console.log("GW_OBJECT_UPSERT", {
    objectId,
    classId,
    barcodeValue: JSON.stringify(loyaltyObjectPayload?.barcode?.value),
  });

  if (googleWalletConfig.isDevEnv) {
    const barcodeValueLength = loyaltyObjectPayload?.barcode?.value?.length || 0;
    console.log("GOOGLE_WALLET_OBJECT_PAYLOAD", {
      objectId,
      barcodeType: loyaltyObjectPayload?.barcode?.type || null,
      barcodeValueLength,
      barcodeValueJson: JSON.stringify(
        loyaltyObjectPayload?.barcode?.value ?? ""
      ),
      stamps: cardDoc?.stamps ?? 0,
      rewards: cardDoc?.rewards ?? 0,
      textModules: textModules?.length ?? 0,
      links: linksModuleData?.uris?.length ?? 0,
    });
  }

  let existed = false;
  const handleWalletError = (err, payload) => {
    logInvalidResourcePayload({
      err,
      label: "loyaltyObject",
      payload,
    });

    throw err;
  };

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/loyaltyObject/${objectId}`,
    });

    existed = true;

    try {
      await walletRequest({
        method: "PATCH",
        path: `/walletobjects/v1/loyaltyObject/${objectId}`,
        body: loyaltyObjectPayload,
      });
      console.log("GW_OBJECT_UPSERT_OK", { objectId });
    } catch (patchErr) {
      handleWalletError(patchErr, loyaltyObjectPayload);
    }
  } catch (err) {
    if (err?.status !== 404) {
      handleWalletError(err, loyaltyObjectPayload);
    }

    try {
      await walletRequest({
        method: "POST",
        path: "/walletobjects/v1/loyaltyObject",
        body: loyaltyObjectPayload,
      });
      console.log("GW_OBJECT_UPSERT_OK", { objectId });
    } catch (createErr) {
      handleWalletError(createErr, loyaltyObjectPayload);
    }
  }

  cardDoc.googleWallet = cardDoc.googleWallet || {};
  cardDoc.googleWallet.objectId = objectId;
  await cardDoc.save();

  return { objectId, classId, existed };
}

export async function ensureGenericClassForMerchant({
  merchantId,
  forcePatch = false,
  template,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  const customer = await Customer.findOne({ merchantId });
  if (!customer) {
    throw new Error("Customer not found for this merchant");
  }

  const templateDoc = template || (await CardTemplate.findOne({ merchantId }).lean());
  const customer = await Customer.findOne({ merchantId }).lean();
  const classPrefix = `${googleWalletConfig.classPrefix}${GENERIC_CLASS_PREFIX_SUFFIX}`;

  const classId = makeClassId({
    issuerId: googleWalletConfig.issuerId,
    classPrefix,
    merchantId,
  });

  const genericClass = await buildGenericClassPayload({
    classId,
    customer,
    template: templateDoc,
  });

  let existed = false;

  const handleWalletError = (err, payload) => {
    if (isGoogleWalletBadRequest(err) && googleWalletConfig.isDevEnv) {
      console.warn(
        "GW_GENERIC_CLASS_SYNC_ERROR",
        classId,
        err?.responseBody?.error?.message
      );
    }

    logInvalidResourcePayload({
      err,
      label: "genericClass",
      payload,
    });

    throw err;
  };

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/genericClass/${classId}`,
    });

    existed = true;

    if (forcePatch) {
      try {
        await walletRequest({
          method: "PATCH",
          path: `/walletobjects/v1/genericClass/${classId}`,
          body: genericClass,
        });
      } catch (err) {
        handleWalletError(err, genericClass);
      }
    }
  } catch (err) {
    if (err?.status !== 404) {
      handleWalletError(err, genericClass);
    }

    try {
      await walletRequest({
        method: "POST",
        path: "/walletobjects/v1/genericClass",
        body: genericClass,
      });
    } catch (createErr) {
      handleWalletError(createErr, genericClass);
    }
  }

  await persistClassId(customer, classId);

  return { classId, existed };
}

export async function ensureGenericObjectForCard({
  merchantId,
  cardId,
  forcePatch = false,
  template,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  if (!cardId) {
    throw new Error("cardId is required");
  }

  const cardDoc = await Card.findById(cardId);
  if (!cardDoc) {
    throw new Error("Card not found");
  }

  if (String(cardDoc.merchantId) !== String(merchantId)) {
    throw new Error("Card does not belong to merchant");
  }

  const templateDoc = template || (await CardTemplate.findOne({ merchantId }).lean());

  const { classId } = await ensureGenericClassForMerchant({
    merchantId,
    forcePatch,
    template: templateDoc,
  });

  const objectId = makeObjectId({
    issuerId: googleWalletConfig.issuerId,
    cardId,
  });

  const barcodeValue = await resolveLoyaltyObjectBarcode({ card: cardDoc, cardId });
  const textModulesData = buildGenericFrontFields({ card: cardDoc, template: templateDoc });
  const genericObjectPayload = buildGenericObjectPayload({
    objectId,
    classId,
    barcodeValue,
    textModulesData,
    template: templateDoc,
    customer,
  });

  let existed = false;
  const handleWalletError = (err, payload) => {
    logInvalidResourcePayload({
      err,
      label: "genericObject",
      payload,
    });

    throw err;
  };

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/genericObject/${objectId}`,
    });

    existed = true;

    try {
      await walletRequest({
        method: "PATCH",
        path: `/walletobjects/v1/genericObject/${objectId}`,
        body: genericObjectPayload,
      });
    } catch (patchErr) {
      handleWalletError(patchErr, genericObjectPayload);
    }
  } catch (err) {
    if (err?.status !== 404) {
      handleWalletError(err, genericObjectPayload);
    }

    try {
      await walletRequest({
        method: "POST",
        path: "/walletobjects/v1/genericObject",
        body: genericObjectPayload,
      });
    } catch (createErr) {
      handleWalletError(createErr, genericObjectPayload);
    }
  }

  cardDoc.googleWallet = cardDoc.googleWallet || {};
  cardDoc.googleWallet.objectId = objectId;
  cardDoc.googleWallet.passType = "generic";
  await cardDoc.save();

  return { objectId, classId, existed };
}

function resolveDesiredPassType(cardDoc, template) {
  const templatePassType = template?.wallet?.google?.passType;
  const genericEnabled =
    templatePassType === "generic" &&
    template?.wallet?.google?.genericConfig?.enabled === true;

  if (template) {
    return genericEnabled ? "generic" : "loyalty";
  }

  return cardDoc?.googleWallet?.passType === "generic" ? "generic" : "loyalty";
}

export async function ensureGoogleClassForMerchant({
  merchantId,
  templateOverride = null,
  forcePatch = false,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  const template =
    templateOverride || (await CardTemplate.findOne({ merchantId }).lean());

  const passType = resolveDesiredPassType(null, template);

  if (passType === "generic") {
    const result = await ensureGenericClassForMerchant({
      merchantId,
      forcePatch,
      template,
    });

    return { ...result, passType };
  }

  const result = await ensureLoyaltyClassForMerchant({
    merchantId,
    forcePatch,
    template,
  });

  return { ...result, passType };
}

export async function ensureGooglePassForCard({
  merchantId,
  cardId,
  templateOverride = null,
  forcePatch = false,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  if (!cardId) {
    throw new Error("cardId is required");
  }

  const card = await Card.findById(cardId);

  if (!card) {
    throw new Error("Card not found");
  }

  const template =
    templateOverride || (await CardTemplate.findOne({ merchantId }).lean());

  const passType = resolveDesiredPassType(card, template);

  let result;

  if (passType === "generic") {
    result = await ensureGenericObjectForCard({
      merchantId,
      cardId,
      forcePatch,
      template,
    });
  } else {
    result = await ensureLoyaltyObjectForCard({ merchantId, cardId, forcePatch });
  }

  const nextPassType = passType || "loyalty";
  const nextObjectId = result?.objectId || null;

  card.googleWallet = card.googleWallet || {};

  const shouldUpdatePassType = card.googleWallet.passType !== nextPassType;
  const shouldUpdateObjectId =
    nextObjectId && card.googleWallet.objectId !== nextObjectId;

  if (shouldUpdatePassType) {
    card.googleWallet.passType = nextPassType;
  }

  if (shouldUpdateObjectId) {
    card.googleWallet.objectId = nextObjectId;
  }

  if (shouldUpdatePassType || shouldUpdateObjectId) {
    await card.save();
  }

  return { ...result, passType };
}

export async function ensureLoyaltyObjectForWalletToken({ walletToken }) {
  if (!walletToken) {
    throw new Error("walletToken is required");
  }

  const card = await Card.findOne({ walletToken });

  if (!card) {
    throw new Error("Card not found");
  }

  return ensureLoyaltyObjectForCard({
    merchantId: card.merchantId,
    cardId: card._id,
  });
}

export function buildAddToGoogleWalletUrl({
  classId,
  objectId,
  passType = "loyalty",
  logger = null,
}) {
  if (!objectId) {
    throw new Error("objectId is required");
  }

  if (!classId) {
    throw new Error("classId is required for Save to Google Wallet");
  }

  let payloadKey = "loyaltyObjects";

  if (passType === "generic") {
    payloadKey = "genericObjects";
  } else if (passType !== "loyalty") {
    logger?.warn?.(
      { passType },
      "unsupported Google Wallet passType, falling back to loyalty"
    );
  }

  const serviceAccount = loadGoogleWalletServiceAccount();
  const { private_key: privateKey, private_key_id: privateKeyId } = serviceAccount;

  if (!privateKey || !privateKeyId) {
    throw new Error("Google Wallet credentials missing private_key/private_key_id");
  }

  const claims = {
    iss: serviceAccount.client_email,
    aud: "google",
    typ: "savetowallet",
    payload: {
      [payloadKey]: [
        {
          id: objectId,
          classId,
        },
      ],
    },
  };

  if (googleWalletConfig.isDevEnv) {
    console.log("SAVE_TO_WALLET_CLAIMS", {
      classId,
      objectId,
      claims,
      passType,
    });
  }

  const token = jwt.sign(claims, privateKey, {
    algorithm: "RS256",
    header: {
      typ: "JWT",
      kid: privateKeyId,
    },
  });

  return `https://pay.google.com/gp/v/save/${token}`;
}

export async function createAddToWalletLinkForCard(cardId, options = {}) {
  if (!cardId) {
    throw new Error("cardId is required");
  }

  const { templateOverride = null, logger = null } = options;

  const card = await Card.findById(cardId);

  if (!card) {
    throw new Error("Card not found");
  }

  const template =
    templateOverride || (await CardTemplate.findOne({ merchantId: card.merchantId }).lean());
  const googleWalletEnabled = Boolean(template?.wallet?.google?.enabled);

  const { classId, objectId, passType } = await ensureGooglePassForCard({
    merchantId: card.merchantId,
    cardId,
    templateOverride: template,
  });

  const url = buildAddToGoogleWalletUrl({
    classId,
    objectId,
    passType,
    logger,
  });

  logger?.info?.(
    { merchantId: card.merchantId, cardId, passType, classId, objectId, googleWalletEnabled },
    "Google Wallet add-to-wallet link generated"
  );

  return { url, classId, objectId, passType };
}

export async function syncGoogleWalletObject(cardId, logger = null) {
  try {
    const card = await Card.findById(cardId);

    if (!card) return;

    await ensureGooglePassForCard({
      merchantId: card.merchantId,
      cardId: card._id,
    });
  } catch (err) {
    if (logger?.warn) {
      logger.warn({ err, cardId }, "google wallet sync failed");
    } else {
      console.warn("google wallet sync failed", err);
    }
  }
}

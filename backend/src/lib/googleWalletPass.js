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
import { buildPublicCardPayload } from "./publicPayload.js";

const DEFAULT_PROGRAM_NAME = "Pluxeo";
const DEFAULT_PRIMARY_COLOR = "#FF9900";
const DEV_DEFAULT_LOGO_URL =
  "https://storage.googleapis.com/wallet-lab-tools-codelab-artifacts/LoyaltyClass/loyalty_class_logo.png";
const MAX_TEXT_MODULES = 4;
const MAX_BARCODE_LENGTH = 120;
const FALLBACK_IMAGE_URL = "https://www.pluxeo.com/logo.png";

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
    .filter((tm) => tm.header || tm.body)
    .slice(0, MAX_TEXT_MODULES);
}

function sanitizeLinks(links) {
  if (!Array.isArray(links)) return [];

  return links
    .map((link) => ({
      uri: (link?.uri || "").trim(),
      description: (link?.description || "").trim(),
    }))
    .filter((link) => isValidHttpsUrl(link.uri));
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

function buildClassTemplateInfo({ templateTextModuleCount }) {
  const rows = [];
  const dynamicIndexStart = Math.max(0, templateTextModuleCount);
  const dynamicTextRowIndices = [dynamicIndexStart, dynamicIndexStart + 1];

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

  rows.push({
    twoItems: {
      startItem: buildTextModuleTemplate(dynamicTextRowIndices[0]),
      endItem: buildTextModuleTemplate(dynamicTextRowIndices[1]),
    },
  });

  if (templateTextModuleCount > 0) {
    const templateIndices = [0, 1].map((idx) =>
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
  const walletGoogle = template?.wallet?.google || {};
  const sanitized = sanitizeTextModules(walletGoogle.textModules);

  const templateModules = sanitized.map((module, idx) => ({
    id: `tpl_${idx}`,
    header: module.header,
    body: module.body,
  }));

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

  return [...templateModules, ...dynamicModules];
}

function buildObjectLinksModuleData(template) {
  const walletGoogle = template?.wallet?.google || {};
  const linksModuleUris = sanitizeLinks(walletGoogle.links).map((link, idx) => ({
    uri: link.uri,
    description: link.description || `Otevřít odkaz ${idx + 1}`,
  }));

  return linksModuleUris.length > 0 ? { uris: linksModuleUris } : null;
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
  const textModulesData = sanitizeTextModules(walletGoogle.textModules);
  const classTemplateInfo = buildClassTemplateInfo({
    templateTextModuleCount: textModulesData.length,
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
  const publicPayload = await buildPublicCardPayload(cardId);
  const redeemCodeValue = normBarcodeValue(publicPayload?.redeemCode?.code);

  if (redeemCodeValue) {
    return redeemCodeValue.slice(0, MAX_BARCODE_LENGTH);
  }

  const scanCode = normBarcodeValue(card?.scanCode);
  return scanCode ? scanCode.slice(0, MAX_BARCODE_LENGTH) : "";
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

  if (Array.isArray(textModulesData) && textModulesData.length > 0) {
    payload.textModulesData = textModulesData;
  }

  if (linksModuleData?.uris?.length > 0) {
    payload.linksModuleData = linksModuleData;
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

  let existed = false;

  const handleWalletError = (err) => {
    if (isGoogleWalletBadRequest(err) && googleWalletConfig.isDevEnv) {
      console.warn(
        "GW_CLASS_SYNC_ERROR",
        classId,
        err?.responseBody?.error?.message
      );
    }

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
        handleWalletError(err);
      }
    }
  } catch (err) {
    if (err?.status !== 404) {
      handleWalletError(err);
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
      handleWalletError(createErr);
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
  const textModulesData = buildObjectTextModules({ template, card: cardDoc });
  const linksModuleData = buildObjectLinksModuleData(template);

  const loyaltyObjectPayload = buildLoyaltyObjectPayload({
    objectId,
    classId,
    card: cardDoc,
    barcodeValue,
    textModulesData,
    linksModuleData,
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
      textModules: textModulesData?.length ?? 0,
      links: linksModuleData?.uris?.length ?? 0,
    });
  }

  let existed = false;

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/loyaltyObject/${objectId}`,
    });

    existed = true;

    await walletRequest({
      method: "PATCH",
      path: `/walletobjects/v1/loyaltyObject/${objectId}`,
      body: loyaltyObjectPayload,
    });
  } catch (err) {
    if (err?.status !== 404) {
      throw err;
    }

    await walletRequest({
      method: "POST",
      path: "/walletobjects/v1/loyaltyObject",
      body: loyaltyObjectPayload,
    });
  }

  cardDoc.googleWallet = cardDoc.googleWallet || {};
  cardDoc.googleWallet.objectId = objectId;
  await cardDoc.save();

  return { objectId, classId, existed };
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

export function buildAddToGoogleWalletUrl({ classId, objectId }) {
  if (!objectId) {
    throw new Error("objectId is required");
  }

  if (!classId) {
    throw new Error("classId is required for Save to Google Wallet");
  }

  const serviceAccount = loadGoogleWalletServiceAccount();

  const claims = {
    iss: serviceAccount.client_email,
    aud: "google",
    typ: "savetowallet",
    payload: {
      loyaltyObjects: [
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
    });
  }

  const token = jwt.sign(claims, serviceAccount.private_key, { algorithm: "RS256" });

  return `https://pay.google.com/gp/v/save/${token}`;
}

export async function createAddToWalletLinkForCard(cardId) {
  if (!cardId) {
    throw new Error("cardId is required");
  }

  const card = await Card.findById(cardId);

  if (!card) {
    throw new Error("Card not found");
  }

  const { classId } = await ensureLoyaltyClassForMerchant({
    merchantId: card.merchantId,
  });

  const { objectId } = await ensureLoyaltyObjectForCard({
    merchantId: card.merchantId,
    cardId,
  });

  const url = buildAddToGoogleWalletUrl({ classId, objectId });

  return { url, classId, objectId };
}

export async function syncGoogleWalletObject(cardId, logger = null) {
  try {
    const card = await Card.findById(cardId);

    if (!card) return;

    await ensureLoyaltyObjectForCard({
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

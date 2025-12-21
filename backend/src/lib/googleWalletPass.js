import { googleWalletConfig } from "../config/googleWallet.config.js";
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";
import jwt from "jsonwebtoken";
import { walletRequest } from "./googleWalletClient.js";
import { loadGoogleWalletServiceAccount } from "./googleWalletAuth.js";
import { makeClassId, makeObjectId } from "./googleWalletIds.js";

const DEFAULT_PROGRAM_NAME = "Pluxeo";
const DEFAULT_PRIMARY_COLOR = "#FF9900";
const DEV_DEFAULT_LOGO_URL =
  "https://storage.googleapis.com/wallet-lab-tools-codelab-artifacts/LoyaltyClass/loyalty_class_logo.png";
const DEFAULT_HEADLINE = "Věrnostní program";
const DEFAULT_SUBHEADLINE = "Sbírejte body a odměny s Pluxeo.";
const MAX_TEXT_MODULES = 4;
const MAX_BARCODE_LENGTH = 120;

function isValidHttpsUrl(url) {
  return typeof url === "string" && url.trim().toLowerCase().startsWith("https://");
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

function buildLoyaltyClassPayload({ classId, customer, template }) {
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
  const logoUrlCandidate = walletGoogle.logoUrl?.trim();
  const logoUrl = isValidHttpsUrl(logoUrlCandidate)
    ? logoUrlCandidate
    : resolveDefaultLogoUrl();
  const heroImageUrl = walletGoogle.heroImageUrl?.trim();
  const textModulesData = sanitizeTextModules(walletGoogle.textModules);
  const linksModuleUris = sanitizeLinks(walletGoogle.links);

  const payload = {
    id: classId,
    issuerName,
    programName,
    reviewStatus: "UNDER_REVIEW",
    programLogo: {
      sourceUri: { uri: logoUrl },
    },
    hexBackgroundColor: primaryColor,
    textModulesData:
      textModulesData.length > 0
        ? textModulesData
        : [
            {
              header: DEFAULT_HEADLINE,
              body: DEFAULT_SUBHEADLINE,
            },
          ],
  };

  if (isValidHttpsUrl(heroImageUrl)) {
    payload.heroImage = {
      sourceUri: { uri: heroImageUrl },
    };
  }

  if (linksModuleUris.length > 0) {
    payload.linksModuleData = {
      uris: linksModuleUris,
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

function pickActiveRedeemCode(redeemCodes = []) {
  const activeCodes = redeemCodes.filter(({ status }) => status === "active");
  return (
    activeCodes.find(({ purpose }) => purpose === "reward") ||
    activeCodes.find(({ purpose }) => purpose === "coupon") ||
    null
  );
}

function buildLoyaltyObjectPayload({ objectId, classId, card, redeemCode }) {
  const headline =
    (card?.rewards || 0) > 0 ? "Odměna dostupná ✅" : "Sbírej razítka";

  const activeCodes = (card?.redeemCodes || []).filter(
    ({ status }) => status === "active"
  );
  const rewardCode =
    redeemCode?.purpose === "reward"
      ? redeemCode
      : activeCodes.find(({ purpose }) => purpose === "reward");
  const couponCode =
    redeemCode?.purpose === "coupon"
      ? redeemCode
      : activeCodes.find(({ purpose }) => purpose === "coupon");

  const barcodeCandidates = [rewardCode, couponCode].filter(Boolean);

  let barcodeValue = "";
  let barcodeAlternateText;

  for (const candidate of barcodeCandidates) {
    const candidateValue = (candidate?.code || "").trim();
    if (candidateValue && candidateValue.length <= MAX_BARCODE_LENGTH) {
      barcodeValue = candidateValue;
      barcodeAlternateText =
        candidate.purpose === "reward"
          ? "Odměna k uplatnění"
          : "Kupón k uplatnění";
      break;
    }
  }

  if (!barcodeValue) {
    const walletToken = (card?.walletToken || "").trim();
    if (walletToken) {
      barcodeValue =
        walletToken.length <= MAX_BARCODE_LENGTH
          ? walletToken
          : walletToken.slice(0, MAX_BARCODE_LENGTH);
      barcodeAlternateText = "Pluxeo karta";
    }
  }

  const basePayload = {
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
    infoModuleData: {
      labelValueRows: [
        {
          columns: [
            { label: "Razítka", value: String(card?.stamps ?? 0) },
            { label: "Odměny", value: String(card?.rewards ?? 0) },
          ],
        },
      ],
    },
    textModulesData: [
      {
        header: headline,
        body: `Razítka: ${card?.stamps ?? 0}\nOdměny: ${card?.rewards ?? 0}`,
      },
    ],
  };

  if (barcodeValue) {
    basePayload.barcode = {
      type: "QR_CODE",
      value: barcodeValue,
      ...(barcodeAlternateText ? { alternateText: barcodeAlternateText } : {}),
    };
  }

  return basePayload;
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

  const loyaltyClass = buildLoyaltyClassPayload({
    classId,
    customer,
    template: templateDoc,
  });

  let existed = false;

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/loyaltyClass/${classId}`,
    });
    existed = true;

    if (forcePatch) {
      await walletRequest({
        method: "PATCH",
        path: `/walletobjects/v1/loyaltyClass/${classId}`,
        body: loyaltyClass,
      });
    }
  } catch (err) {
    if (err?.status !== 404) {
      throw err;
    }

    await walletRequest({
      method: "POST",
      path: "/walletobjects/v1/loyaltyClass",
      body: loyaltyClass,
    });
  }

  await persistClassId(customer, classId);

  return { classId, existed };
}

export async function ensureLoyaltyObjectForCard({ cardId, card }) {
  if (!cardId && !card) {
    throw new Error("cardId or card is required");
  }

  const cardDoc = card || (await Card.findById(cardId));
  if (!cardDoc) {
    throw new Error("Card not found");
  }

  const { classId } = await ensureLoyaltyClassForMerchant({
    merchantId: cardDoc.merchantId,
  });

  const objectId = makeObjectId({
    issuerId: googleWalletConfig.issuerId,
    cardId: cardId || cardDoc._id,
  });

  const redeemCode = pickActiveRedeemCode(cardDoc.redeemCodes);
  const loyaltyObjectPayload = buildLoyaltyObjectPayload({
    objectId,
    classId,
    card: cardDoc,
    redeemCode,
  });

  let existed = false;

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/loyaltyObject/${objectId}`,
    });

    await walletRequest({
      method: "PATCH",
      path: `/walletobjects/v1/loyaltyObject/${objectId}`,
      body: loyaltyObjectPayload,
    });

    existed = true;
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

  return { objectId, existed };
}

export async function ensureLoyaltyObjectForWalletToken({ walletToken }) {
  if (!walletToken) {
    throw new Error("walletToken is required");
  }

  const card = await Card.findOne({ walletToken });

  if (!card) {
    throw new Error("Card not found");
  }

  return ensureLoyaltyObjectForCard({ card });
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

  const { objectId } = await ensureLoyaltyObjectForCard({ cardId });

  const url = buildAddToGoogleWalletUrl({ classId, objectId });

  return { url, classId, objectId };
}

export async function syncGoogleWalletObject(cardId, logger = null) {
  try {
    await ensureLoyaltyObjectForCard({ cardId });
  } catch (err) {
    if (logger?.warn) {
      logger.warn({ err, cardId }, "google wallet sync failed");
    } else {
      console.warn("google wallet sync failed", err);
    }
  }
}

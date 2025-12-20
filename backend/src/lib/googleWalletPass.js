import { googleWalletConfig } from "../config/googleWallet.config.js";
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import jwt from "jsonwebtoken";
import { walletRequest } from "./googleWalletClient.js";
import { loadGoogleWalletServiceAccount } from "./googleWalletAuth.js";
import { makeClassId, makeObjectId } from "./googleWalletIds.js";

const DEFAULT_PROGRAM_NAME = "Pluxeo";
const DEFAULT_PRIMARY_COLOR = "#FF9900";
const DEFAULT_LOGO_URL =
  process.env.PLUXEO_DEFAULT_LOGO_URL ||
  "https://via.placeholder.com/512x512.png?text=Pluxeo";
const DEFAULT_HEADLINE = "Věrnostní program";
const DEFAULT_SUBHEADLINE = "Sbírejte body a odměny s Pluxeo.";

function buildLoyaltyClassPayload({ classId, customer }) {
  const programName = (customer?.name || "").trim() || DEFAULT_PROGRAM_NAME;
  const logoUrl =
    customer?.settings?.logoUrl?.trim() || DEFAULT_LOGO_URL;
  const primaryColor =
    customer?.settings?.themeColor?.trim() || DEFAULT_PRIMARY_COLOR;

  return {
    id: classId,
    issuerName: programName,
    programName,
    reviewStatus: "UNDER_REVIEW",
    programLogo: {
      sourceUri: { uri: logoUrl },
    },
    hexBackgroundColor: primaryColor,
    textModulesData: [
      {
        header: DEFAULT_HEADLINE,
        body: DEFAULT_SUBHEADLINE,
      },
    ],
  };
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

  if (redeemCode?.code) {
    basePayload.barcode = {
      type: "QR_CODE",
      value: redeemCode.code,
      alternateText:
        redeemCode.purpose === "coupon" ? "Kupón k uplatnění" : "Odměna k uplatnění",
    };
  }

  return basePayload;
}

export async function ensureLoyaltyClassForMerchant({ merchantId }) {
  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  const customer = await Customer.findOne({ merchantId });
  if (!customer) {
    throw new Error("Customer not found for this merchant");
  }

  const classId = makeClassId({
    issuerId: googleWalletConfig.issuerId,
    classPrefix: googleWalletConfig.classPrefix,
    merchantId,
  });

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/loyaltyClass/${classId}`,
    });

    await persistClassId(customer, classId);
    return { classId, existed: true };
  } catch (err) {
    if (err?.status !== 404) {
      throw err;
    }
  }

  const loyaltyClass = buildLoyaltyClassPayload({ classId, customer });

  await walletRequest({
    method: "POST",
    path: "/walletobjects/v1/loyaltyClass",
    body: loyaltyClass,
  });

  await persistClassId(customer, classId);

  return { classId, existed: false };
}

export async function ensureLoyaltyObjectForCard({ cardId }) {
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

  const objectId = makeObjectId({
    issuerId: googleWalletConfig.issuerId,
    cardId,
  });

  const redeemCode = pickActiveRedeemCode(card.redeemCodes);
  const loyaltyObjectPayload = buildLoyaltyObjectPayload({
    objectId,
    classId,
    card,
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

  card.googleWallet = card.googleWallet || {};
  card.googleWallet.objectId = objectId;
  await card.save();

  return { objectId, existed };
}

export function buildAddToGoogleWalletUrl({ classId, objectId }) {
  if (!objectId) {
    throw new Error("objectId is required");
  }

  const serviceAccount = loadGoogleWalletServiceAccount();

  const walletPayload = {
    loyaltyObjects: [{ id: objectId }],
  };

  if (classId) {
    walletPayload.loyaltyClasses = [{ id: classId }];
  }

  const token = jwt.sign(
    {
      iss: serviceAccount.client_email,
      aud: "google",
      typ: "savetowallet",
      payload: walletPayload,
    },
    serviceAccount.private_key,
    { algorithm: "RS256" }
  );

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

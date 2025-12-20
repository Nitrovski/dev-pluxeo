import { googleWalletConfig } from "../config/googleWallet.config.js";
import { Customer } from "../models/customer.model.js";
import { walletRequest } from "./googleWalletClient.js";
import { makeClassId } from "./googleWalletIds.js";

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

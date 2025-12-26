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
const MAX_TEXT_MODULES = 5;
const PROMO_MAX_LENGTH = 60;
const GENERIC_PROMO_MAX_LENGTH = 40;
const MAX_BARCODE_LENGTH = 120;
const FALLBACK_IMAGE_URL = "https://www.pluxeo.com/logo.png";
const GENERIC_CLASS_PREFIX_SUFFIX = "_generic";
const DEFAULT_GENERIC_LAYOUT = {
  cardRows: [
    { type: "two", left: null, right: null },
    { type: "two", left: null, right: null },
    { type: "one", value: null },
  ],
};
const GENERIC_LAYOUT_SLOT_IDS = [
  { type: "two", left: "r1_left", right: "r1_right" },
  { type: "two", left: "r2_left", right: "r2_right" },
  { type: "one", value: "r3" },
];
const GENERIC_FIELD_LABELS = {
  promoText: "AKCE",
  stamps: "Razítka",
  rewards: "Odměny",
  openingHours: "Otevírací doba",
  websiteUrl: "Web",
  customMessage: "Zpráva",
};
const GENERIC_FIELD_LABELS_I18N = {
  cs: {
    promoText: "AKCE",
    stamps: "Razítka",
    rewards: "Odměna",
    openingHours: "Otevírací doba",
    websiteUrl: "Web",
    customMessage: "Zpráva",
  },
  en: {
    promoText: "Info",
    stamps: "Stamps",
    rewards: "Reward",
    openingHours: "Opening hours",
    websiteUrl: "Website",
    customMessage: "Message",
  },
};
const GENERIC_FIELD_META = {
  promoText: { defaultShowLabel: false },
  customMessage: { defaultShowLabel: false },
  stamps: { defaultShowLabel: true },
  rewards: { defaultShowLabel: true },
  openingHours: { defaultShowLabel: true },
  websiteUrl: { defaultShowLabel: true },
};

function isObj(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

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
      const allowHeaderless = module?.allowHeaderless === true;
      const header = trimTextModuleValue(module?.header);
      const body = trimTextModuleValue(module?.body);

      const normalized = { ...(module || {}) };
      delete normalized.header;
      delete normalized.body;
      delete normalized.allowHeaderless;

      if (header) {
        normalized.header = header;
      }

      normalized.body = body;

      return { normalized, allowHeaderless };
    })
    // Google Wallet rejects entries without a header unless we explicitly allow headerless modules.
    .filter(
      ({ normalized, allowHeaderless }) =>
        normalized.body && (normalized.header || allowHeaderless)
    )
    .map(({ normalized }) => normalized)
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

function normalizeGenericLayoutSlot(slot) {
  if (!isObj(slot)) return null;

  const fieldId = typeof slot.fieldId === "string" ? slot.fieldId : null;
  const label = typeof slot.label === "string" ? slot.label : null;
  const showLabel = typeof slot.showLabel === "boolean" ? slot.showLabel : undefined;

  if (!fieldId) return null;

  return { fieldId, label, showLabel };
}

function buildLegacyGenericLayout(template) {
  const cfg = template?.wallet?.google?.genericConfig || {};
  const fields = [];

  if (cfg.showPromo && sanitizeGenericPromoText(template?.promoText)) {
    fields.push("promoText");
  }

  if (cfg.showStampsModule) {
    fields.push("stamps", "rewards");
  }

  if (cfg.showOpeningHours && String(template?.openingHours || "").trim()) {
    fields.push("openingHours");
  }

  if (cfg.showWebsite && normalizeWebsiteUrl(template?.websiteUrl)) {
    fields.push("websiteUrl");
  }

  const cardRows = [
    {
      type: "two",
      left: fields[0] ? { fieldId: fields[0] } : null,
      right: fields[1] ? { fieldId: fields[1] } : null,
    },
    {
      type: "two",
      left: fields[2] ? { fieldId: fields[2] } : null,
      right: fields[3] ? { fieldId: fields[3] } : null,
    },
    {
      type: "one",
      value: fields[4] ? { fieldId: fields[4] } : null,
    },
  ];

  return { cardRows };
}

function normalizeGenericLayout(layout, template) {
  if (!isObj(layout) || !Array.isArray(layout.cardRows)) {
    return buildLegacyGenericLayout(template);
  }

  const rows = layout.cardRows.slice(0, 3);
  const normalizedRows = rows.map((row, idx) => {
    const defaultType = idx < 2 ? "two" : "one";
    const rowType = row?.type === "one" || row?.type === "two" ? row.type : defaultType;

    if (rowType === "one") {
      return {
        type: "one",
        value: normalizeGenericLayoutSlot(row?.value),
      };
    }

    return {
      type: "two",
      left: normalizeGenericLayoutSlot(row?.left),
      right: normalizeGenericLayoutSlot(row?.right),
    };
  });

  while (normalizedRows.length < 3) {
    if (normalizedRows.length < 2) {
      normalizedRows.push({ type: "two", left: null, right: null });
    } else {
      normalizedRows.push({ type: "one", value: null });
    }
  }

  return { cardRows: normalizedRows };
}

function buildGenericLayoutSlots({ template }) {
  const layout = normalizeGenericLayout(
    template?.wallet?.google?.genericConfig?.layout,
    template
  );

  const slots = [];

  layout.cardRows.forEach((row, idx) => {
    const slotIds = GENERIC_LAYOUT_SLOT_IDS[idx];

    if (!slotIds) return;

    if (row?.type === "one") {
      if (row?.value?.fieldId) {
        slots.push({
          slotId: slotIds.value,
          fieldId: row.value.fieldId,
          label: row.value.label,
          showLabel: row.value.showLabel,
        });
      }
      return;
    }

    if (row?.left?.fieldId) {
      slots.push({
        slotId: slotIds.left,
        fieldId: row.left.fieldId,
        label: row.left.label,
        showLabel: row.left.showLabel,
      });
    }

    if (row?.right?.fieldId) {
      slots.push({
        slotId: slotIds.right,
        fieldId: row.right.fieldId,
        label: row.right.label,
        showLabel: row.right.showLabel,
      });
    }
  });

  return slots;
}

function resolveGenericLocale({ template, card } = {}) {
  const candidate =
    template?.wallet?.google?.locale ||
    template?.wallet?.google?.language ||
    template?.locale ||
    card?.locale;
  const normalized = String(candidate || "").trim().toLowerCase();
  if (normalized === "en") return "en";
  return "cs";
}

function resolveGenericFieldLabel(fieldId, locale, fallbackLabels = GENERIC_FIELD_LABELS) {
  const labels = GENERIC_FIELD_LABELS_I18N[locale] || GENERIC_FIELD_LABELS_I18N.cs;
  return labels[fieldId] || fallbackLabels[fieldId] || fieldId || "";
}

function resolveGenericFieldValue({ fieldId, card, template }) {
  if (fieldId === "stamps") {
    const stamps = Number(card?.stamps ?? 0);
    return String(stamps);
  }

  if (fieldId === "rewards") {
    const rewards = Number(card?.rewards ?? 0);
    return String(rewards);
  }

  if (fieldId === "promoText") {
    return String(template?.promoText ?? "").trim();
  }

  if (fieldId === "openingHours") {
    return String(template?.openingHours ?? "").trim();
  }

  if (fieldId === "websiteUrl") {
    return String(template?.websiteUrl ?? "").trim();
  }

  if (fieldId === "customMessage") {
    return String(template?.customMessage ?? "").trim();
  }

  return "";
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

function buildTextModuleTemplateForSlot(slotId) {
  return {
    firstValue: {
      fields: [{ fieldPath: `object.textModulesData['${slotId}'].header` }],
    },
    secondValue: {
      fields: [{ fieldPath: `object.textModulesData['${slotId}'].body` }],
    },
  };
}

function buildGenericClassTemplateInfo({ template }) {
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

function buildGenericLinksModuleData({ template }) {
  const normalizedWebsite = normalizeWebsiteUrl(template?.websiteUrl);
  if (!normalizedWebsite) return null;

  const slots = buildGenericLayoutSlots({ template });
  const websiteSlot = slots.find((slot) => slot.fieldId === "websiteUrl");
  if (!websiteSlot) return null;
  const locale = resolveGenericLocale({ template });

  return {
    uris: [
      {
        uri: normalizedWebsite,
        description: websiteSlot.label || resolveGenericFieldLabel("websiteUrl", locale),
      },
    ],
  };
}

function buildGenericFrontFields({ card, template }) {
  const slots = buildGenericLayoutSlots({ template });
  const locale = resolveGenericLocale({ template, card });

  return slots.map((slot) => {
    const showLabel = slot.showLabel ?? true;
    const body = resolveGenericFieldValue({
      fieldId: slot.fieldId,
      card,
      template,
    });

    const module = {
      id: slot.slotId,
      body,
    };
    // Sanity: front fields always carry label + body (e.g. stamps "3" without "/").

    if (showLabel) {
      const header = slot.label || resolveGenericFieldLabel(slot.fieldId, locale);
      if (header) {
        module.header = header;
      }
    } else {
      module.allowHeaderless = true;
    }

    return module;
  });
}

async function buildGenericClassPayload({ classId, template }) {
  const classTemplateInfo = buildGenericClassTemplateInfo({ template });

  const payload = {
    id: classId,
    reviewStatus: "UNDER_REVIEW",
    classTemplateInfo,
  };

  return payload;
}

async function buildGenericObjectPayload({
  objectId,
  classId,
  barcodeValue,
  textModulesData,
  template,
  customer,
}) {
  const normalizedBarcodeValue = normBarcodeValue(barcodeValue).slice(0, MAX_BARCODE_LENGTH);

  const walletGoogle = template?.wallet?.google || {};
  const issuerName =
    String(walletGoogle.issuerName || customer?.name || "").trim() ||
    DEFAULT_PROGRAM_NAME;
  const cardTitleValue = issuerName;
  const subheadline = String(template?.subheadline || "").trim();
  const headerText = resolveHeaderText({ template, customer });
  const hexBackgroundColor =
    walletGoogle.backgroundColor?.trim() ||
    walletGoogle.hexBackgroundColor?.trim() ||
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

  const payload = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: {
      defaultValue: { language: "cs", value: cardTitleValue },
    },
    header: {
      defaultValue: { language: "cs", value: headerText },
    },
    hexBackgroundColor,
    logo: {
      sourceUri: { uri: logoUrl },
    },
  };

  if (subheadline) {
    payload.subheader = { defaultValue: { language: "cs", value: subheadline } };
  }

  if (heroImageUrl) {
    payload.heroImage = { sourceUri: { uri: heroImageUrl } };
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

  const linksModuleData = buildGenericLinksModuleData({ template });
  const sanitizedLinksModule = normalizeLinksModuleData(linksModuleData);

  if (sanitizedLinksModule) {
    payload.linksModuleData = sanitizedLinksModule;
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

function extractGenericClassDebugFields(genericClass) {
  const linkCount = Array.isArray(genericClass?.linksModuleData?.uris)
    ? genericClass.linksModuleData.uris.length
    : 0;
  const hasTemplateInfo = Boolean(
    genericClass?.classTemplateInfo || genericClass?.cardTemplateInfo
  );
  const textModulesCount = Array.isArray(genericClass?.textModulesData)
    ? genericClass.textModulesData.length
    : 0;
  const imageModulesCount = Array.isArray(genericClass?.imageModulesData)
    ? genericClass.imageModulesData.length
    : 0;

  return {
    hasTemplateInfo,
    linksCount: linkCount,
    textModulesCount,
    imageModulesCount,
  };
}

function extractGenericObjectDebugFields(genericObject) {
  const hasLinks =
    Boolean(genericObject?.appLinkData) ||
    (Array.isArray(genericObject?.linksModuleData?.uris) &&
      genericObject.linksModuleData.uris.length > 0);

  return {
    hexBackgroundColor: genericObject?.hexBackgroundColor ?? null,
    logoUri: genericObject?.logo?.sourceUri?.uri ?? null,
    heroImageUri: genericObject?.heroImage?.sourceUri?.uri ?? null,
    cardTitle: genericObject?.cardTitle?.defaultValue?.value ?? null,
    header: genericObject?.header?.defaultValue?.value ?? null,
    hasLinks,
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
  const pendingPatchAt = templateDoc?.walletSync?.google?.generic?.pendingPatchAt;
  const lastPatchedAt = templateDoc?.walletSync?.google?.generic?.lastPatchedAt;
  const patchPending =
    pendingPatchAt &&
    (!lastPatchedAt || new Date(pendingPatchAt) > new Date(lastPatchedAt));
  const classPrefix = `${googleWalletConfig.classPrefix}${GENERIC_CLASS_PREFIX_SUFFIX}`;

  const classId = makeClassId({
    issuerId: googleWalletConfig.issuerId,
    classPrefix,
    merchantId,
  });

  const genericClass = await buildGenericClassPayload({
    classId,
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

  const logGenericClassState = async () => {
    try {
      const savedClass = await walletRequest({
        method: "GET",
        path: `/walletobjects/v1/genericClass/${classId}`,
      });

      console.log("GW_GENERIC_CLASS_SAVED_STATE", {
        classId,
        ...extractGenericClassDebugFields(savedClass || {}),
      });
    } catch (verificationErr) {
      console.warn("GW_GENERIC_CLASS_VERIFY_FAILED", {
        classId,
        error: verificationErr?.message,
      });
    }
  };

  try {
    await walletRequest({
      method: "GET",
      path: `/walletobjects/v1/genericClass/${classId}`,
    });

    existed = true;

    if (forcePatch || patchPending) {
      try {
        const hasRows = Boolean(
          genericClass?.classTemplateInfo?.cardTemplateOverride?.cardRowTemplateInfos
        );
        console.log("GW_GENERIC_CLASS_PATCH_CHECK", { classId, hasRows });
        console.log("GW_GENERIC_CLASS_PATCH_PAYLOAD", {
          classId,
          ...extractGenericClassDebugFields(genericClass),
        });
        await walletRequest({
          method: "PATCH",
          path: `/walletobjects/v1/genericClass/${classId}`,
          body: genericClass,
        });
        await logGenericClassState();
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
  const textModulesData = buildGenericFrontFields({
    card: cardDoc,
    template: templateDoc,
  });
  const customer = await Customer.findOne({ merchantId });
  if (!customer) {
    throw new Error("Customer not found for this merchant");
  }
  const genericObjectPayload = await buildGenericObjectPayload({
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

    if (forcePatch) {
      try {
        await walletRequest({
          method: "PATCH",
          path: `/walletobjects/v1/genericObject/${objectId}`,
          body: genericObjectPayload,
        });

        if (googleWalletConfig.isDevEnv) {
          const savedObject = await walletRequest({
            method: "GET",
            path: `/walletobjects/v1/genericObject/${objectId}`,
          });
          console.log("GW_GENERIC_OBJECT_SAVED_STATE", {
            objectId,
            ...extractGenericObjectDebugFields(savedObject || {}),
          });
        }
      } catch (patchErr) {
        handleWalletError(patchErr, genericObjectPayload);
      }
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

export async function syncGoogleGenericForMerchantTemplate({
  authClient,
  merchantId,
  templateDoc,
}) {
  if (authClient) {
    console.log("GW_GENERIC_TEMPLATE_SYNC_AUTH", { hasAuthClient: Boolean(authClient) });
  }

  if (!merchantId) {
    throw new Error("merchantId is required");
  }

  const template =
    templateDoc && typeof templateDoc.save === "function"
      ? templateDoc
      : await CardTemplate.findOne({ merchantId });

  if (!template) {
    throw new Error("Card template not found for this merchant");
  }

  const customer = await Customer.findOne({ merchantId });
  if (!customer) {
    throw new Error("Customer not found for this merchant");
  }

  const templateValue = typeof template.toObject === "function" ? template.toObject() : template;

  const { classId } = await ensureGenericClassForMerchant({
    merchantId,
    forcePatch: true,
    template: templateValue,
  });

  const layoutSlots = buildGenericLayoutSlots({ template: templateValue });
  const layoutRowsCount = Array.isArray(
    templateValue?.wallet?.google?.genericConfig?.layout?.cardRows
  )
    ? templateValue.wallet.google.genericConfig.layout.cardRows.length
    : DEFAULT_GENERIC_LAYOUT.cardRows.length;
  const activeSlotCount = layoutSlots.length;

  console.log("GW_GENERIC_TEMPLATE_SYNC_LAYOUT", {
    merchantId,
    layoutRowsCount,
    activeSlotCount,
    sampleSlotIds: layoutSlots.map((slot) => slot.slotId),
  });

  const totalCards = await Card.countDocuments({ merchantId });
  console.log("GW_GENERIC_TEMPLATE_SYNC_START", {
    merchantId,
    classId,
    totalCards,
  });

  const batchSize = 200;
  let lastId = null;
  let processed = 0;
  let errors = 0;
  let sampleLogged = 0;

  while (true) {
    const query = { merchantId };
    if (lastId) {
      query._id = { $gt: lastId };
    }

    const batch = await Card.find(query).sort({ _id: 1 }).limit(batchSize);
    if (batch.length === 0) break;

    for (const card of batch) {
      const objectId = makeObjectId({
        issuerId: googleWalletConfig.issuerId,
        cardId: card._id,
      });

      try {
        const barcodeValue = await resolveLoyaltyObjectBarcode({
          card,
          cardId: card._id,
        });
        const textModulesData = buildGenericFrontFields({
          card,
          template: templateValue,
        });
        const hiddenLabelCount = Array.isArray(textModulesData)
          ? textModulesData.filter((module) => module?.allowHeaderless === true).length
          : 0;

        const genericObjectPayload = await buildGenericObjectPayload({
          objectId,
          classId,
          barcodeValue,
          textModulesData,
          template: templateValue,
          customer,
        });

        if (sampleLogged < 2) {
          sampleLogged += 1;
          console.log("GW_GENERIC_OBJECT_SAMPLE", {
            merchantId,
            objectId,
            textModulesCount: Array.isArray(textModulesData) ? textModulesData.length : 0,
            hiddenLabelCount,
            hasLogoUrl: Boolean(templateValue?.wallet?.google?.logoUrl),
            backgroundColor:
              templateValue?.wallet?.google?.backgroundColor ||
              templateValue?.primaryColor ||
              null,
          });
        }

        let existed = false;

        try {
          await walletRequest({
            method: "GET",
            path: `/walletobjects/v1/genericObject/${objectId}`,
          });
          existed = true;
        } catch (getErr) {
          if (getErr?.status !== 404) {
            throw getErr;
          }
        }

        if (existed) {
          await walletRequest({
            method: "PATCH",
            path: `/walletobjects/v1/genericObject/${objectId}`,
            body: genericObjectPayload,
          });

          if (googleWalletConfig.isDevEnv) {
            const savedObject = await walletRequest({
              method: "GET",
              path: `/walletobjects/v1/genericObject/${objectId}`,
            });
            console.log("GW_GENERIC_OBJECT_SAVED_STATE", {
              objectId,
              ...extractGenericObjectDebugFields(savedObject || {}),
            });
          }
        } else {
          await walletRequest({
            method: "POST",
            path: "/walletobjects/v1/genericObject",
            body: genericObjectPayload,
          });
        }

        card.googleWallet = card.googleWallet || {};
        card.googleWallet.objectId = objectId;
        card.googleWallet.passType = "generic";
        await card.save();

        processed += 1;
      } catch (objectErr) {
        errors += 1;
        console.warn("GW_GENERIC_OBJECT_SYNC_FAILED", {
          merchantId,
          cardId: card?._id,
          error: objectErr?.message || objectErr,
        });
      }
    }

    lastId = batch[batch.length - 1]?._id;
    console.log("GW_GENERIC_TEMPLATE_SYNC_BATCH", {
      merchantId,
      classId,
      processed,
      totalCards,
      errors,
      batchSize: batch.length,
    });
  }

  template.walletSync = template.walletSync || {};
  template.walletSync.google = template.walletSync.google || {};
  template.walletSync.google.generic = template.walletSync.google.generic || {};
  template.walletSync.google.generic.lastPatchedAt = new Date();
  template.walletSync.google.generic.pendingPatchAt = null;
  await template.save();

  console.log("GW_GENERIC_TEMPLATE_SYNC_DONE", {
    merchantId,
    classId,
    processed,
    totalCards,
    errors,
  });

  return { classId, processed, totalCards, errors };
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

export async function updateGoogleWalletObjectForCard({
  cardId,
  onBeforePatch = null,
}) {
  if (!cardId) {
    throw new Error("cardId is required");
  }

  const card = await Card.findById(cardId);
  if (!card) {
    throw new Error("Card not found");
  }

  const template = await CardTemplate.findOne({ merchantId: card.merchantId }).lean();
  if (!template) {
    throw new Error("Card template not found for this merchant");
  }

  if (!template?.wallet?.google?.enabled) {
    return { skipped: true, reason: "google wallet disabled" };
  }

  const passType = resolveDesiredPassType(card, template);
  if (passType !== "generic") {
    return { skipped: true, passType };
  }

  const objectId =
    card?.googleWallet?.objectId ||
    makeObjectId({
      issuerId: googleWalletConfig.issuerId,
      cardId: card._id,
    });

  const existingObject = await walletRequest({
    method: "GET",
    path: `/walletobjects/v1/genericObject/${objectId}`,
  });

  const barcodeValue = await resolveLoyaltyObjectBarcode({
    card,
    cardId: card._id,
  });
  const normalizedBarcode = normBarcodeValue(barcodeValue).slice(0, MAX_BARCODE_LENGTH);
  const textModulesData = compactTextModulesData(
    buildGenericFrontFields({
      card,
      template,
    })
  );

  const patchPayload = {
    state: "ACTIVE",
    textModulesData,
  };

  if (normalizedBarcode) {
    patchPayload.barcode = {
      type: "QR_CODE",
      value: normalizedBarcode,
      alternateText: "Pluxeo",
    };
  }

  if (existingObject?.hexBackgroundColor) {
    patchPayload.hexBackgroundColor = existingObject.hexBackgroundColor;
  }

  if (existingObject?.logo?.sourceUri?.uri) {
    patchPayload.logo = { sourceUri: { uri: existingObject.logo.sourceUri.uri } };
  }

  if (existingObject?.heroImage?.sourceUri?.uri) {
    patchPayload.heroImage = {
      sourceUri: { uri: existingObject.heroImage.sourceUri.uri },
    };
  }

  if (existingObject?.cardTitle?.defaultValue?.value) {
    patchPayload.cardTitle = existingObject.cardTitle;
  }

  if (existingObject?.header?.defaultValue?.value) {
    patchPayload.header = existingObject.header;
  }

  if (onBeforePatch) {
    onBeforePatch({
      cardId: String(card._id),
      objectId,
      passType,
    });
  }

  await walletRequest({
    method: "PATCH",
    path: `/walletobjects/v1/genericObject/${objectId}`,
    body: patchPayload,
  });

  return { objectId, passType, patched: true };
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

// src/routes/cardTemplate.routes.js
import { CardTemplate } from "../models/cardTemplate.model.js";
import { Card } from "../models/card.model.js";
import { getAuth } from "@clerk/fastify";
import {
  ensureLoyaltyClassForMerchant,
  ensureLoyaltyObjectForCard,
  resolveDesiredPassType,
  syncGoogleGenericForMerchantTemplate,
} from "../lib/googleWalletPass.js";

function pickString(v, fallback = "") {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function pickNumber(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

const DEFAULT_GENERIC_LAYOUT = {
  cardRows: [
    { type: "two", left: null, right: null },
    { type: "two", left: null, right: null },
    { type: "two", left: null, right: null },
  ],
};

function normalizeLayoutSlot(slot) {
  if (!isObj(slot)) return null;

  const fieldId = typeof slot.fieldId === "string" ? slot.fieldId : null;
  const label = typeof slot.label === "string" ? slot.label : null;
  const showLabel =
    typeof slot.showLabel === "boolean"
      ? slot.showLabel
      : typeof slot.showName === "boolean"
        ? slot.showName
        : undefined;

  if (!fieldId) return null;

  return { fieldId, label, showLabel };
}

function normalizeGenericLayout(layout) {
  // vždy vracíme 3× two
  const emptyTwo = () => ({ type: "two", left: null, right: null });

  if (!isObj(layout) || !Array.isArray(layout.cardRows)) {
    return DEFAULT_GENERIC_LAYOUT;
  }

  const rows = layout.cardRows;

  const normalizedRows = rows.slice(0, 3).map((row) => {
    const rowType = row?.type === "one" || row?.type === "two" ? row.type : "two";

    // legacy: one/value -> two/left/right
    if (rowType === "one") {
      return {
        type: "two",
        left: normalizeLayoutSlot(row?.value),
        right: null,
      };
    }

    // standard: two/left/right
    return {
      type: "two",
      left: normalizeLayoutSlot(row?.left),
      right: normalizeLayoutSlot(row?.right),
    };
  });

  while (normalizedRows.length < 3) {
    normalizedRows.push(emptyTwo());
  }

  return { cardRows: normalizedRows };
}

function hasDuplicateLayoutFields(layout) {
  if (!isObj(layout) || !Array.isArray(layout.cardRows)) return false;

  const seen = new Set();

  const addFieldId = (slot) => {
    const fieldId = slot?.fieldId;
    if (!fieldId) return false;
    if (seen.has(fieldId)) return true;
    seen.add(fieldId);
    return false;
  };

  for (const row of layout.cardRows) {
    if (!isObj(row)) continue;
    if (row.type === "one") {
      if (addFieldId(row.value)) return true;
    } else {
      if (addFieldId(row.left)) return true;
      if (addFieldId(row.right)) return true;
    }
  }

  return false;
}

function normalizeHeaderText(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeAppleSlot(slot) {
  if (!isObj(slot)) return null;

  const fieldId = typeof slot.fieldId === "string" ? slot.fieldId.trim() : "";
  if (!fieldId) return null;

  const label = typeof slot.label === "string" ? slot.label : null;
  const showLabel = typeof slot.showLabel === "boolean" ? slot.showLabel : undefined;

  return { fieldId, label, showLabel };
}

function normalizeAppleSlots(inputSlots, inputIds, fallbackIds) {
  const fallbackSlots = Array.isArray(fallbackIds)
    ? fallbackIds
        .filter((slotId) => typeof slotId === "string" && slotId.trim())
        .map((fieldId) => ({ fieldId }))
    : [];

  let slots = [];

  if (Array.isArray(inputSlots)) {
    slots = inputSlots.map(normalizeAppleSlot).filter((slot) => slot);
  } else if (Array.isArray(inputIds)) {
    slots = inputIds
      .filter((slotId) => typeof slotId === "string" && slotId.trim())
      .map((fieldId) => ({ fieldId }));
  }

  if (slots.length === 0) {
    slots = fallbackSlots;
  }

  return slots;
}

function normalizeAppleWallet(template) {
  const walletIn = isObj(template?.wallet) ? template.wallet : {};
  const appleIn = isObj(walletIn.apple) ? walletIn.apple : {};
  const googleIn = isObj(walletIn.google) ? walletIn.google : {};
  const colorsIn = isObj(appleIn.colors) ? appleIn.colors : {};
  const imagesIn = isObj(appleIn.images) ? appleIn.images : {};
  const layoutIn = isObj(appleIn.layout) ? appleIn.layout : {};

  const programName = pickString(template?.programName, "");
  const headline = pickString(template?.headline, "");
  const primaryColor = pickString(template?.primaryColor, "");
  const rootLogoUrl = pickString(template?.logoUrl, "");

  const googleHeaderText = normalizeHeaderText(googleIn.headerText);
  const googleIssuerName = pickString(googleIn.issuerName, "");
  const googleLogoUrl = pickString(googleIn.logoUrl, "");
  const googleBackgroundColor = pickString(googleIn.backgroundColor, "");

  const resolvedLogoText =
    pickString(appleIn.logoText, "") ||
    programName ||
    headline ||
    googleHeaderText ||
    "Pluxeo";
  const resolvedIssuerName = pickString(appleIn.issuerName, "") || googleIssuerName || "Pluxeo";

  const backgroundColor =
    pickString(colorsIn.backgroundColor, "") ||
    primaryColor ||
    googleBackgroundColor ||
    "#111827";
  const foregroundColor = pickString(colorsIn.foregroundColor, "") || "#FFFFFF";
  const labelColor = pickString(colorsIn.labelColor, "") || "#DDDDDD";

  const logoUrl = pickString(imagesIn.logoUrl, "") || rootLogoUrl || googleLogoUrl || "";
  const iconUrl = pickString(imagesIn.iconUrl, "") || logoUrl;
  const stripUrl = pickString(imagesIn.stripUrl, "") || "";

  const enabled = appleIn.enabled !== undefined ? Boolean(appleIn.enabled) : true;
  const style =
    appleIn.style === "generic" || appleIn.style === "storeCard" ? appleIn.style : "storeCard";
  const primarySource =
    layoutIn.primarySource === "programName" ||
    layoutIn.primarySource === "none" ||
    layoutIn.primarySource === "header"
      ? layoutIn.primarySource
      : "header";

  const secondarySlots = normalizeAppleSlots(
    layoutIn.secondarySlots,
    layoutIn.secondarySlotIds,
    ["stamps", "rewards"]
  );
  const auxiliarySlots = normalizeAppleSlots(
    layoutIn.auxiliarySlots,
    layoutIn.auxiliarySlotIds,
    ["websiteUrl", "openingHours", "tier", "email"]
  );

  return {
    enabled,
    style,
    logoText: resolvedLogoText,
    issuerName: resolvedIssuerName,
    colors: {
      backgroundColor,
      foregroundColor,
      labelColor,
    },
    images: {
      logoUrl,
      iconUrl,
      stripUrl,
    },
    layout: {
      primarySource,
      secondarySlots,
      auxiliarySlots,
    },
  };
}

const VALID_CARD_TYPES = new Set(["custom", "stamps", "coupon", "info"]);

function resolveCardType(template) {
  if (VALID_CARD_TYPES.has(template?.cardType)) return template.cardType;
  if (VALID_CARD_TYPES.has(template?.programType)) return template.programType;
  return "custom";
}

function resolveFreeStampsToReward(template) {
  const candidate =
    template?.freeStampsToReward ?? template?.rules?.freeStampsToReward ?? 10;
  return Number.isFinite(Number(candidate)) ? Math.floor(Number(candidate)) : 10;
}

function createConcurrencyQueue(limit, items, handler) {
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const item = items[currentIndex];
      // eslint-disable-next-line no-await-in-loop
      await handler(item);
    }
  };

  return Promise.all(Array.from({ length: limit }).map(() => worker()));
}

/**
 * Normalize wallet shape so FE never receives wallet: null / invalid.
 * Also normalizes links to { label, uri } (FE schema expects that).
 */
function normalizeWallet(inWallet, template) {
  const w = isObj(inWallet) ? inWallet : {};

  const googleIn = isObj(w.google) ? w.google : {};

  const genericConfigIn = isObj(googleIn.genericConfig) ? googleIn.genericConfig : {};
  const layoutIn = genericConfigIn.layout;
  const normalizedLayout = normalizeGenericLayout(layoutIn);
  const barcodeIn = isObj(genericConfigIn.barcode) ? genericConfigIn.barcode : {};

  const google = {
    enabled: Boolean(googleIn.enabled),
    passType: "generic",
    headerText: normalizeHeaderText(googleIn.headerText),
    issuerName: pickString(googleIn.issuerName, ""),
    programName: pickString(googleIn.programName, ""),
    logoUrl: pickString(googleIn.logoUrl, ""),
    backgroundColor: pickString(googleIn.backgroundColor, "#FF9900") || "#FF9900",
    heroImageUrl: pickString(googleIn.heroImageUrl, ""),
    links: Array.isArray(googleIn.links)
      ? googleIn.links
          .filter((x) => isObj(x))
          .map((link) => ({
            // FE schema uses: { label, uri }
            label: pickString(link.label ?? link.description, ""),
            uri: pickString(link.uri, ""),
          }))
      : [],
    textModules: Array.isArray(googleIn.textModules)
      ? googleIn.textModules
          .filter((x) => isObj(x))
          .map((tm) => ({
            header: pickString(tm.header, ""),
            body: pickString(tm.body, ""),
          }))
      : [],
    genericConfig: {
      enabled: Boolean(genericConfigIn.enabled),
      showStampsModule:
        genericConfigIn.showStampsModule !== undefined
          ? Boolean(genericConfigIn.showStampsModule)
          : true,
      showPromo: genericConfigIn.showPromo !== undefined ? Boolean(genericConfigIn.showPromo) : true,
      showWebsite: Boolean(genericConfigIn.showWebsite),
      showOpeningHours: Boolean(genericConfigIn.showOpeningHours),
      showEmail: Boolean(genericConfigIn.showEmail),
      showTier: Boolean(genericConfigIn.showTier),
      barcode: {
        enabled: barcodeIn.enabled !== undefined ? Boolean(barcodeIn.enabled) : true,
        type: typeof barcodeIn.type === "string" ? barcodeIn.type : "QR_CODE",
      },
      layout: normalizedLayout,
    },
    // meta fields if present in DB
    classId: typeof googleIn.classId === "string" ? googleIn.classId : undefined,
    synced: typeof googleIn.synced === "boolean" ? googleIn.synced : undefined,
  };

  const appleSource = template || { wallet: w };
  const apple = normalizeAppleWallet(appleSource);

  return { google, apple };
}

function toApi(template, merchantId) {
  // vracíme tvar, který FE očekává (CardTemplatePage)
  const wallet = normalizeWallet(template?.wallet, template);
  const cardType = resolveCardType(template);
  const freeStampsToReward = resolveFreeStampsToReward(template);

  return {
    merchantId,

    programType: template?.programType || cardType,
    cardType,
    programName: template?.programName || "",
    headline: template?.headline || "",
    subheadline: template?.subheadline || "",
    customMessage: template?.customMessage || "",
    promoText: template?.promoText || "",
    openingHours: template?.openingHours || "",
    websiteUrl: template?.websiteUrl || "",
    detailsText: template?.detailsText ?? null,
    termsText: template?.termsText ?? null,

    // pravidla programu
    freeStampsToReward,
    couponText: template?.rules?.couponText ?? "",

    primaryColor: template?.primaryColor || "#FF9900",
    secondaryColor: template?.secondaryColor || "#111827",
    logoUrl: template?.logoUrl || "",

    wallet,
  };
}

async function cardTemplateRoutes(fastify, options) {
  /**
   * GET /api/card-template
   */
  fastify.get("/api/card-template", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const template = await CardTemplate.findOne({ merchantId }).lean();

      // pokud šablona neexistuje -> vrať default
      if (!template) {
        const defaultTpl = {
          programType: "custom",
          cardType: "custom",
          programName: "",
          headline: "",
          subheadline: "",
          customMessage: "",
          promoText: "",
          openingHours: "",
          websiteUrl: "",
          detailsText: null,
          termsText: null,
          freeStampsToReward: 10,
          rules: {
            freeStampsToReward: 10,
            couponText: "",
          },
          primaryColor: "#FF9900",
          secondaryColor: "#111827",
          logoUrl: "",
          wallet: {
            google: {
              enabled: false,
              passType: "generic",
              headerText: null,
              issuerName: "",
              programName: "",
              logoUrl: "",
              backgroundColor: "#FF9900",
              heroImageUrl: "",
              links: [],
              textModules: [],
              genericConfig: {
                enabled: false,
                showStampsModule: true,
                showPromo: true,
                showWebsite: false,
                showOpeningHours: false,
                showEmail: false,
                showTier: false,
                barcode: { enabled: true, type: "QR_CODE" },
                layout: DEFAULT_GENERIC_LAYOUT,
              },
            },
            apple: {},
          },
        };

        return reply.send(toApi(defaultTpl, merchantId));
      }

      return reply.send(toApi(template, merchantId));
    } catch (err) {
      request.log.error(err, "Error fetching card template");
      return reply.code(500).send({ error: "Error fetching card template" });
    }
  });

  /**
   * PUT /api/card-template
   */
  fastify.put("/api/card-template", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const payload = request.body || {};
      const existingTemplate = await CardTemplate.findOne({ merchantId }).lean();

      console.log("TEMPLATE_PUT_INCOMING_LAYOUT", {
        merchantId,
        layout: payload?.wallet?.google?.genericConfig?.layout?.cardRows,
      });

      console.log("TEMPLATE_PUT_INCOMING_ROOT_FIELDS", {
        merchantId,
        promoText: payload?.promoText,
        customMessage: payload?.customMessage,
        openingHours: payload?.openingHours,
        websiteUrl: payload?.websiteUrl,
      });

      if (hasDuplicateLayoutFields(payload?.wallet?.google?.genericConfig?.layout)) {
        return reply.code(400).send({ error: "Duplicate field in layout" });
      }

      // NOTE: máš to zapnuté natvrdo – nechávám jak je
      const syncWalletObjects = true;
      const syncWalletObjectsLimit = 10;
      const syncWalletObjectsConcurrency = 3;

      // whitelist podle FE tvaru
      const incomingCardType =
        payload.cardType || payload.programType || resolveCardType(existingTemplate);
      const resolvedCardType = VALID_CARD_TYPES.has(incomingCardType)
        ? incomingCardType
        : "custom";

      const hasWallet = Object.prototype.hasOwnProperty.call(payload, "wallet");
      const hasAppleWallet =
        hasWallet &&
        isObj(payload.wallet) &&
        Object.prototype.hasOwnProperty.call(payload.wallet, "apple");

      const templateForAppleNormalization = {
        ...(existingTemplate || {}),
        programName: payload.programName ?? existingTemplate?.programName,
        headline: payload.headline ?? existingTemplate?.headline,
        primaryColor: payload.primaryColor ?? existingTemplate?.primaryColor,
        logoUrl: payload.logoUrl ?? existingTemplate?.logoUrl,
        wallet: {
          ...(existingTemplate?.wallet || {}),
          google: {
            ...(existingTemplate?.wallet?.google || {}),
            ...(payload?.wallet?.google || {}),
          },
          apple: {
            ...(existingTemplate?.wallet?.apple || {}),
            ...(payload?.wallet?.apple || {}),
          },
        },
      };

      const update = {
        programType: payload.programType, // "stamps" | "coupon"
        cardType: payload.cardType,
        programName: payload.programName,
        headline: payload.headline,
        subheadline: payload.subheadline,
        customMessage: payload.customMessage,
        promoText: payload.promoText,
        openingHours: payload.openingHours,
        websiteUrl: payload.websiteUrl,
        detailsText: payload.detailsText,
        termsText: payload.termsText,
        primaryColor: payload.primaryColor,
        secondaryColor: payload.secondaryColor,
        logoUrl: payload.logoUrl,

        // DŮLEŽITÉ: normalizuj wallet, nikdy neukládej null
        wallet: hasWallet ? normalizeWallet(payload.wallet, templateForAppleNormalization) : undefined,

        rules: {
          freeStampsToReward: payload.freeStampsToReward,
          couponText: payload.couponText,
        },
      };

      // vyčisti undefined/null hodnoty (null bereme jako "neposláno", ať se ti to nevymaže v DB)
      const $set = { merchantId };
      const hasDetailsText = Object.prototype.hasOwnProperty.call(payload, "detailsText");
      const hasTermsText = Object.prototype.hasOwnProperty.call(payload, "termsText");

      for (const [key, value] of Object.entries(update)) {
        if (value === undefined || value === null) continue;

        if (key === "rules") {
          const rules = {};

          if (value.freeStampsToReward !== undefined && value.freeStampsToReward !== null) {
            const normalizedValue = Number(value.freeStampsToReward);
            if (!Number.isFinite(normalizedValue)) {
              if (resolvedCardType === "stamps") {
                return reply
                  .code(400)
                  .send({ error: "freeStampsToReward must be >= 1" });
              }
            } else {
              const normalizedFreeStamps = Math.floor(normalizedValue);
              if (normalizedFreeStamps < 1) {
                if (resolvedCardType === "stamps") {
                  return reply
                    .code(400)
                    .send({ error: "freeStampsToReward must be >= 1" });
                }
              } else {
                rules.freeStampsToReward = normalizedFreeStamps;
                $set.freeStampsToReward = normalizedFreeStamps;
              }
            }
          }

          if (value.couponText !== undefined && value.couponText !== null) {
            rules.couponText = pickString(value.couponText, "");
          }

          if (Object.keys(rules).length > 0) {
            $set.rules = rules;
          }
        } else if (key === "wallet") {
          const wallet = normalizeWallet(value, templateForAppleNormalization);

          // save google
          const g = wallet.google;

          $set["wallet.google.enabled"] = Boolean(g.enabled);
          $set["wallet.google.headerText"] = normalizeHeaderText(g.headerText);
          $set["wallet.google.issuerName"] = pickString(g.issuerName, "");
          $set["wallet.google.programName"] = pickString(g.programName, "");
          $set["wallet.google.logoUrl"] = pickString(g.logoUrl, "");
          $set["wallet.google.backgroundColor"] =
            pickString(g.backgroundColor, "#FF9900") || "#FF9900";
          $set["wallet.google.heroImageUrl"] = pickString(g.heroImageUrl, "");
          $set["wallet.google.links"] = Array.isArray(g.links) ? g.links : [];
          $set["wallet.google.textModules"] = Array.isArray(g.textModules) ? g.textModules : [];
          $set["wallet.google.genericConfig"] =
            g.genericConfig || {
              enabled: false,
              showStampsModule: true,
              showPromo: true,
              showWebsite: false,
              showOpeningHours: false,
              showEmail: false,
              showTier: false,
              barcode: { enabled: true, type: "QR_CODE" },
              layout: DEFAULT_GENERIC_LAYOUT,
            };

          // save apple only if payload includes it
          if (hasAppleWallet) {
            $set["wallet.apple"] = normalizeAppleWallet(templateForAppleNormalization);
          }
        } else if (key === "programType") {
          const normalizedProgramType = VALID_CARD_TYPES.has(value) ? value : "custom";
          $set.programType = normalizedProgramType;
          $set.cardType = normalizedProgramType;
        } else if (key === "cardType") {
          $set.cardType = resolvedCardType;
          $set.programType = resolvedCardType;
        } else if (key === "promoText") {
          $set.promoText = pickString(value, "");
        } else if (key === "logoUrl") {
          $set.logoUrl = pickString(value, "");
        } else if (key === "termsText") {
          // handled separately to allow explicit nulls
        } else if (key === "detailsText") {
          // handled separately to allow explicit nulls
        } else if (typeof value === "string") {
          // POZOR: prázdný string je validní (uživatel může chtít vymazat hodnotu)
          $set[key] = value;
        } else {
          $set[key] = value;
        }
      }

      if (hasTermsText) {
        if (typeof payload.termsText === "string") {
          const trimmed = payload.termsText.trim();
          $set.termsText = trimmed ? trimmed : null;
        } else if (payload.termsText === null) {
          $set.termsText = null;
        }
      }

      if (hasDetailsText) {
        if (typeof payload.detailsText === "string") {
          const trimmed = payload.detailsText.trim();
          $set.detailsText = trimmed ? trimmed : null;
        } else if (payload.detailsText === null) {
          $set.detailsText = null;
        }
      }

      // TODO: pokud zavedeme "global switch programu", synchronizovat card.type/stampsPerReward.
      const template = await CardTemplate.findOneAndUpdate(
        { merchantId },
        { $set },
        { new: true, upsert: true }
      );

      // extra safety: normalize wallet from DB before using/sending
      template.wallet = normalizeWallet(template.wallet, template);
      const templateValue = template.toObject();

      const effectivePassType = resolveDesiredPassType(null, template);

      const walletSyncResult = {
        classSynced: false,
        classId: null,
        objectsSynced: 0,
        objectsFailed: 0,
        passType: effectivePassType,
      };

      template.walletSync = template.walletSync || {};
      template.walletSync.google = template.walletSync.google || {};
      template.walletSync.google.generic = template.walletSync.google.generic || {};
      template.walletSync.google.generic.pendingPatchAt = new Date();
      await template.save();

      if (effectivePassType === "generic") {
        try {
          const syncResult = await syncGoogleGenericForMerchantTemplate({
            merchantId,
            templateDoc: template,
          });

          walletSyncResult.classSynced = true;
          walletSyncResult.classId = syncResult?.classId ?? null;
          walletSyncResult.objectsSynced = syncResult?.processed ?? 0;
          walletSyncResult.objectsFailed = syncResult?.errors ?? 0;
        } catch (syncErr) {
          request.log.warn({ err: syncErr }, "google wallet generic sync failed");
        }
      } else {
        try {
          const syncResult = await ensureLoyaltyClassForMerchant({
            merchantId,
            forcePatch: true,
            template: templateValue,
          });

          walletSyncResult.classSynced = true;
          walletSyncResult.classId = syncResult?.classId ?? null;
        } catch (syncErr) {
          request.log.warn({ err: syncErr }, "google wallet class sync failed");
        }

        if (syncWalletObjects) {
          try {
            const cardsToSync = await Card.find({ merchantId })
              .sort({ updatedAt: -1 })
              .limit(syncWalletObjectsLimit)
              .select({ _id: 1 })
              .lean();

            await createConcurrencyQueue(syncWalletObjectsConcurrency, cardsToSync, async (card) => {
              try {
                await ensureLoyaltyObjectForCard({
                  merchantId,
                  cardId: card._id,
                  forcePatch: true,
                });
                walletSyncResult.objectsSynced += 1;
              } catch (objectErr) {
                walletSyncResult.objectsFailed += 1;
                request.log.warn(
                  { err: objectErr, cardId: card?._id },
                  "google wallet object sync failed"
                );
              }
            });
          } catch (objectsSyncErr) {
            request.log.warn({ err: objectsSyncErr }, "google wallet objects sync batch failed");
          }
        }
      }

      console.log("TEMPLATE_SAVE_RESPONSE_LAYOUT", {
        merchantId,
        effectivePassType,
        cardRows: toApi(template, merchantId)?.wallet?.google?.genericConfig?.layout?.cardRows,
      });

      return reply.send({
        ...toApi(template, merchantId),
        googleWallet: walletSyncResult,
      });
    } catch (err) {
      request.log.error(err, "Error updating card template");
      return reply.code(500).send({ error: "Error updating card template" });
    }
  });
}

export default cardTemplateRoutes;

import { CardTemplate } from "../models/cardTemplate.model.js";
import { Card } from "../models/card.model.js";
import { getAuth } from "@clerk/fastify";
import {
  ensureLoyaltyClassForMerchant,
  ensureLoyaltyObjectForCard,
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

  return Promise.all(
    Array.from({ length: limit }).map(() => worker())
  );
}

function toApi(template, merchantId) {
  // vracme tvar, kter FE ocekv (CardTemplatePage)
  const walletGoogle = template?.wallet?.google || {};

  return {
    merchantId,

    programType: template?.programType || "stamps",
    programName: template?.programName || "",
    headline: template?.headline || "",
    subheadline: template?.subheadline || "",
    customMessage: template?.customMessage || "",
    openingHours: template?.openingHours || "",
    websiteUrl: template?.websiteUrl || "",

    // ?? pravidla programu
    freeStampsToReward: template?.rules?.freeStampsToReward ?? 10,
    couponText: template?.rules?.couponText ?? "",

    primaryColor: template?.primaryColor || "#FF9900",
    secondaryColor: template?.secondaryColor || "#111827",
    logoUrl: template?.logoUrl || "",

    wallet: {
      google: {
        enabled: Boolean(walletGoogle.enabled),
        issuerName: walletGoogle.issuerName || "",
        programName: walletGoogle.programName || "",
        logoUrl: walletGoogle.logoUrl || "",
        backgroundColor: walletGoogle.backgroundColor || "",
        heroImageUrl: walletGoogle.heroImageUrl || "",
        links: Array.isArray(walletGoogle.links)
          ? walletGoogle.links.map((link) => ({
              uri: link?.uri || "",
              description: link?.description || "",
            }))
          : [],
        textModules: Array.isArray(walletGoogle.textModules)
          ? walletGoogle.textModules.map((tm) => ({
              header: tm?.header || "",
              body: tm?.body || "",
            }))
          : [],
      },
    },
  };
}

async function cardTemplateRoutes(fastify, options) {
  /**
   * GET /api/card-template
   * Vrt ablonu karty pro prihlenho merchanta
   */
  fastify.get("/api/card-template", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const template = await CardTemplate.findOne({ merchantId }).lean();

      // pokud ablona neexistuje ? vrtme default
      if (!template) {
        return reply.send(
          toApi(
            {
              programType: "stamps",
              programName: "",
              headline: "",
              subheadline: "",
              customMessage: "",
              openingHours: "",
              websiteUrl: "",
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
                  issuerName: "",
                  programName: "",
                  logoUrl: "",
                  backgroundColor: "",
                  heroImageUrl: "",
                  links: [],
                  textModules: [],
                },
              },
            },
            merchantId
          )
        );
      }

      return reply.send(toApi(template, merchantId));
    } catch (err) {
      request.log.error(err, "Error fetching card template");
      return reply.code(500).send({ error: "Error fetching card template" });
    }
  });

  /**
   * PUT /api/card-template
   * Ulo / aktualizuje ablonu karty pro merchanta
   */
  fastify.put("/api/card-template", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const payload = request.body || {};
      const syncWalletObjects =
        request.query?.syncWalletObjects === "1" ||
        request.query?.syncWalletObjects === "true";

      const syncWalletObjectsLimit = Math.min(
        200,
        Math.max(1, pickNumber(request.query?.syncWalletObjectsLimit, 50) || 50)
      );

      const syncWalletObjectsConcurrency = Math.min(
        5,
        Math.max(1, pickNumber(request.query?.syncWalletObjectsConcurrency, 3) || 3)
      );

      // whitelist presne podle FE tvaru
      const update = {
        programType: payload.programType, // "stamps" | "coupon"
        programName: payload.programName,
        headline: payload.headline,
        subheadline: payload.subheadline,
        customMessage: payload.customMessage,
        openingHours: payload.openingHours,
        websiteUrl: payload.websiteUrl,
        primaryColor: payload.primaryColor,
        secondaryColor: payload.secondaryColor,
        logoUrl: payload.logoUrl,

        wallet: payload.wallet,

        rules: {
          freeStampsToReward: payload.freeStampsToReward,
          couponText: payload.couponText,
        },
      };

      // vycisti undefined hodnoty
      const $set = { merchantId };

      for (const [key, value] of Object.entries(update)) {
        if (value === undefined) continue;

        if (key === "rules") {
          const rules = {};
          if (value.freeStampsToReward !== undefined) {
            rules.freeStampsToReward = pickNumber(
              value.freeStampsToReward,
              10
            );
          }
          if (value.couponText !== undefined) {
            rules.couponText = pickString(value.couponText, "");
          }
          if (Object.keys(rules).length > 0) {
            $set.rules = rules;
          }
        } else if (key === "wallet") {
          const walletGoogle = value?.google;

          if (walletGoogle && typeof walletGoogle === "object") {
            if (walletGoogle.enabled !== undefined) {
              $set["wallet.google.enabled"] = Boolean(walletGoogle.enabled);
            }
            if (walletGoogle.issuerName !== undefined) {
              $set["wallet.google.issuerName"] = pickString(
                walletGoogle.issuerName,
                ""
              );
            }
            if (walletGoogle.programName !== undefined) {
              $set["wallet.google.programName"] = pickString(
                walletGoogle.programName,
                ""
              );
            }
            if (walletGoogle.logoUrl !== undefined) {
              $set["wallet.google.logoUrl"] = pickString(
                walletGoogle.logoUrl,
                ""
              );
            }
            if (walletGoogle.backgroundColor !== undefined) {
              $set["wallet.google.backgroundColor"] = pickString(
                walletGoogle.backgroundColor,
                ""
              );
            }
            if (walletGoogle.heroImageUrl !== undefined) {
              $set["wallet.google.heroImageUrl"] = pickString(
                walletGoogle.heroImageUrl,
                ""
              );
            }
            if (walletGoogle.links !== undefined) {
              const links = Array.isArray(walletGoogle.links)
                ? walletGoogle.links.map((link) => ({
                    uri: pickString(link?.uri, ""),
                    description: pickString(link?.description, ""),
                  }))
                : [];

              $set["wallet.google.links"] = links;
            }
            if (walletGoogle.textModules !== undefined) {
              const textModules = Array.isArray(walletGoogle.textModules)
                ? walletGoogle.textModules.map((tm) => ({
                    header: pickString(tm?.header, ""),
                    body: pickString(tm?.body, ""),
                  }))
                : [];

              $set["wallet.google.textModules"] = textModules;
            }
          }
        } else if (key === "programType") {
          $set.programType = value === "coupon" ? "coupon" : "stamps";
        } else if (key === "logoUrl") {
          $set.logoUrl = pickString(value, "");
        } else if (typeof value === "string") {
          $set[key] = value;
        } else {
          $set[key] = value;
        }
      }

      const template = await CardTemplate.findOneAndUpdate(
        { merchantId },
        { $set },
        { new: true, upsert: true }
      ).lean();

      const walletSyncResult = {
        classSynced: false,
        classId: null,
        objectsSynced: 0,
        objectsFailed: 0,
      };

      try {
        const { classId } = await ensureLoyaltyClassForMerchant({
          merchantId,
          forcePatch: true,
          template,
        });

        walletSyncResult.classSynced = true;
        walletSyncResult.classId = classId;
      } catch (syncErr) {
        request.log.warn({ err: syncErr }, "google wallet class sync failed");
      }

      if (syncWalletObjects) {
        try {
          const cardsToSync = await Card.find({
            merchantId,
            "googleWallet.objectId": { $exists: true, $ne: null },
          })
            .sort({ updatedAt: -1 })
            .limit(syncWalletObjectsLimit)
            .select({ _id: 1 })
            .lean();

          await createConcurrencyQueue(
            syncWalletObjectsConcurrency,
            cardsToSync,
            async (card) => {
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
            }
          );
        } catch (objectsSyncErr) {
          request.log.warn(
            { err: objectsSyncErr },
            "google wallet objects sync batch failed"
          );
        }
      }

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

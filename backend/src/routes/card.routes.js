// src/routes/card.routes.js
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";
import { getAuth } from "@clerk/fastify";
import crypto from "crypto";
import { CardEvent } from "../models/cardEvent.model.js";
import { normalizeCardContent } from "../utils/normalizeCardContent.js";
import { pickRedeemForDisplay, issueRedeemCode } from "../lib/redeemCodes.js";




// ⚠️ DŮLEŽITÉ:
// normalizeCardContent musí být dostupné (buď je v tomhle souboru níž,
// nebo ho importuj např.:
// import { normalizeCardContent } from "../lib/cardContent.js";

function generateRedeemCode() {
  // scan-friendly: PX-XXXX-XXXX-XXXX
  const raw = crypto.randomBytes(8).toString("base64url").toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `PX-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

async function cardRoutes(fastify, options) {
  /**
   * POST /api/cards
   * Vytvoří novou kartu pro PŘIHLÁŠENÉHO merchanta
   */
  fastify.post("/api/cards", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const payload = request.body || {};
      const { customerId, walletToken: incomingWalletToken, ...rest } = payload;

      const walletToken =
        incomingWalletToken || crypto.randomUUID().replace(/-/g, "");

      const card = await Card.create({
        ...rest,
        merchantId,
        customerId,
        walletToken,
        lastEventAt: new Date(),
      });

      await CardEvent.create({
        merchantId,
        cardId: card._id,
        walletToken: card.walletToken,
        type: "CARD_CREATED",
        deltaStamps: 0,
        deltaRewards: 0,
        cardType: card.type ?? "stamps",
        templateId: card.templateId ?? null,
        actor: {
          type: "merchant",
          actorId: merchantId,
          source: "merchant-app",
        },
        payload: {
          customerId,
        },
      });

      return reply.code(201).send(card);
    } catch (err) {
      request.log.error({ err, body: request.body }, "Error creating card");

      if (err.code === 11000) {
        return reply
          .code(409)
          .send({ error: "Card with this walletToken already exists" });
      }

      return reply.code(500).send({
        error: "Error creating card",
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
    }
  });

/**
 * POST /api/cards/:id/redeem/issue
 * Vydá nový redeem kód (reward / coupon)
 *
 * Body:
 * {
 *   purpose: "reward" | "coupon",
 *   validTo?: ISODateString,
 *   meta?: object
 * }
 *
 * ������ Pouze pro přihlášeného merchanta
 * ✅ max 1 aktivní redeem kód na purpose (starý se expiroval)
 * ❌ neuplatňuje kód (jen ho vydá)
 */
fastify.post("/api/cards/:id/redeem/issue", async (request, reply) => {
  try {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }

    const { id } = request.params;
    const merchantId = userId;

    const purposeRaw = request.body?.purpose;
    const purpose = purposeRaw === "coupon" ? "coupon" : "reward";

    const validToRaw = request.body?.validTo;
    const meta = request.body?.meta ?? null;

    const validTo = validToRaw ? new Date(validToRaw) : null;
    if (validTo && isNaN(validTo.getTime())) {
      return reply.code(400).send({ error: "Invalid validTo date" });
    }

    const card = await Card.findOne({ _id: id, merchantId });
    if (!card) {
      return reply.code(404).send({ error: "Card not found" });
    }

    // ------------------------------------------------------------
    // Generuj nový redeem kód
    // ------------------------------------------------------------
    const code = generateRedeemCode();

    // Vydání redeem kódu (helper řeší expiraci starého)
    issueRedeemCode(card, {
      code,
      purpose,
      validTo,
      meta,
      rotateStrategy: "expireAndIssue",
    });

    card.lastEventAt = new Date();
    await card.save();

    // ------------------------------------------------------------
    // Audit log
    // ------------------------------------------------------------
    await CardEvent.create({
      merchantId,
      cardId: card._id,
      walletToken: card.walletToken,
      type: purpose === "reward" ? "REWARD_ISSUED" : "COUPON_ISSUED",
      deltaStamps: 0,
      deltaRewards: 0,
      cardType: card.type ?? null,
      templateId: card.templateId ?? null,
      actor: {
        type: "merchant",
        actorId: merchantId,
        source: "merchant-app",
      },
      payload: {
        code,
        purpose,
        validTo,
        meta,
      },
    });

    return reply.send({
      ok: true,
      cardId: String(card._id),
      issued: {
        code,
        purpose,
        validTo,
        meta,
      },
    });
  } catch (err) {
    if (err?.code === "ACTIVE_REDEEM_EXISTS") {
      return reply.code(409).send({ error: "Active redeem already exists" });
    }

    request.log.error(err, "Error issuing redeem code");
    return reply.code(500).send({ error: "Error issuing redeem code" });
  }
});

  /**
   * GET /api/cards
   * Vrátí všechny karty aktuálního merchanta
   */
  fastify.get("/api/cards", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const cards = await Card.find({ merchantId }).lean();
      return reply.send(cards);
    } catch (err) {
      request.log.error(err, "Error fetching cards");
      return reply.code(500).send({ error: "Error fetching cards" });
    }
  });

  /**
   * GET /api/cards/:id
   * Vrátí detail karty podle ID (plná data) – jen když patří danému merchantovi
   */
  fastify.get("/api/cards/:id", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const { id } = request.params;
      const merchantId = userId;

      const card = await Card.findOne({ _id: id, merchantId });
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      return reply.send(card);
    } catch (err) {
      request.log.error(err, "Error fetching card");
      return reply.code(500).send({ error: "Error fetching card" });
    }
  });

/**
 * POST /api/cards/:id/stamp
 * Přidá razítko (default +1, nebo podle body.amount)
 * ✅ Pravidla bere z AKTUÁLNÍ CardTemplate (globálně pro merchanta)
 * ✅ Funguje pouze pokud je aktivní program cardType === "stamps"
 * ✅ Při REWARD_EARNED vygeneruje redeemCode do card.redeemCodes
 * ������ Pouze pro přihlášeného merchanta a jen na jeho kartě.
 */
fastify.post("/api/cards/:id/stamp", async (request, reply) => {
  try {
    const { isAuthenticated, userId } = getAuth(request);

    if (!isAuthenticated || !userId) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }

    const { id } = request.params;
    const merchantId = userId;

    // amount: jen integer + rozumný rozsah
    const amountRaw = request.body?.amount;
    const amount = Number.isInteger(amountRaw) ? amountRaw : 1;

    if (amount < 1 || amount > 5) {
      return reply.code(400).send({ error: "amount must be integer 1..5" });
    }

    const card = await Card.findOne({ _id: id, merchantId });
    if (!card) {
      return reply.code(404).send({ error: "Card not found" });
    }

    // (VOLITELNÉ) anti double-scan guard
    // Pokud chceš vypnout, smaž tento blok.
    const now = new Date();
    const COOLDOWN_MS = 1200; // 1.2s, aby scan čtečky neudělaly dvojklik
    if (card.lastEventAt) {
      const diff = Date.now() - new Date(card.lastEventAt).getTime();
      if (diff >= 0 && diff < COOLDOWN_MS) {
        return reply.code(429).send({
          error: "stamp throttled",
          retryAfterMs: COOLDOWN_MS - diff,
        });
      }
    }

    // globální template pro merchanta
    const template = await CardTemplate.findOne({ merchantId }).lean();
    const activeCardType = template?.cardType ?? "stamps";

    if (activeCardType !== "stamps") {
      return reply.code(409).send({
        error: "Active program is not stamps",
        cardType: activeCardType,
      });
    }

    // threshold z template rules (fallback pro starší data)
    const thresholdRaw =
      template?.rules?.freeStampsToReward ??
      template?.freeStampsToReward ??
      10;

    const thresholdNum = Number(thresholdRaw);
    const threshold =
      Number.isFinite(thresholdNum) && thresholdNum > 0
        ? Math.floor(thresholdNum)
        : 10;

    const prevStamps = Number(card.stamps || 0);
    const prevRewards = Number(card.rewards || 0);

    // ------------------------------------------------------------
    // LOGIKA: stamps držíme jako "progress do další odměny"
    // -> po dosažení threshold se odečte threshold a přidá reward
    // ------------------------------------------------------------
    let newStamps = prevStamps + amount;
    let newRewards = prevRewards;

    while (newStamps >= threshold) {
      newRewards += 1;
      newStamps -= threshold;
    }

    const rewardDelta = newRewards - prevRewards;

    card.stamps = newStamps;
    card.rewards = newRewards;
    card.lastEventAt = now;

    // ✅ při získání alespoň jedné odměny vystav (nebo obnov) 1 aktivní reward redeem
    if (rewardDelta > 0) {
      issueRedeemCode(card, {
        code: generateRedeemCode(),
        purpose: "reward",
        validTo: null,
        meta: {
          source: "stamp",
          threshold,
          earned: rewardDelta, // kolik odměn přibylo
        },
        rotateStrategy: "expireAndIssue",
      });
    }

    await card.save();

    // ------------------------------------------------------------
    // EVENTY
    // ------------------------------------------------------------
    await CardEvent.create({
      merchantId,
      cardId: card._id,
      walletToken: card.walletToken,
      type: "STAMP_ADDED",
      deltaStamps: amount,
      deltaRewards: 0,
      cardType: activeCardType,
      templateId: card.templateId ?? null,
      actor: {
        type: "merchant",
        actorId: merchantId,
        source: "merchant-app",
      },
      payload: {
        threshold,
        prevStamps,
        newStamps,
      },
    });

    if (rewardDelta > 0) {
      await CardEvent.create({
        merchantId,
        cardId: card._id,
        walletToken: card.walletToken,
        type: "REWARD_EARNED",
        deltaStamps: 0,
        deltaRewards: rewardDelta,
        cardType: activeCardType,
        templateId: card.templateId ?? null,
        actor: {
          type: "merchant",
          actorId: merchantId,
          source: "merchant-app",
        },
        payload: {
          threshold,
          rewardDelta,
          redeemCodesIssued: 1, // 1 aktivní redeem (PassKit-friendly)
        },
      });
    }

    // (VOLITELNÉ) když chceš rovnou vrátit i public payload:
    // const publicPayload = await buildPublicCardPayload(String(card._id));
    // return reply.send({ ok: true, card, public: publicPayload });

    return reply.send(card);
  } catch (err) {
    request.log.error(err, "Error adding stamp");
    return reply.code(500).send({ error: "Error adding stamp" });
  }
});


  /**
   * GET /api/cards/:id/public
   * Public data pro mobil / wallet (bez auth)
   * - template je zdroj pravdy (globální pro merchanta)
   * - customer.cardContent je jen override (když není prázdné)
   * - vrací payload v1 + legacy top-level fields
   *
   * ✅ NOVĚ:
   * - podporuje paralelní reward + coupon
   * - vybírá redeem podle priority (reward → coupon)
   * - PassKit-ready (pass.barcode je kanonický zdroj)
   */
  fastify.get("/api/cards/:id/public", async (request, reply) => {
    try {
      const { id } = request.params;

      const card = await Card.findById(id).lean();
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      const template = await CardTemplate.findOne({
        merchantId: card.merchantId,
      }).lean();

      let customer = null;
      if (card.customerId) {
        customer = await Customer.findOne({
          customerId: card.customerId,
          merchantId: card.merchantId,
        }).lean();
      }

      function pickNonEmpty(override, base) {
        if (override === null || override === undefined) return base;
        if (typeof override === "string") return override.trim() ? override : base;
        return override;
      }

      function mapToPKBarcodeFormat(redeemFormat, barcodeType) {
        const f = String(redeemFormat || "qr").toLowerCase();
        if (f === "qr") return "PKBarcodeFormatQR";

        const t = String(barcodeType || "").toLowerCase();
        if (t.includes("pdf")) return "PKBarcodeFormatPDF417";
        if (t.includes("aztec")) return "PKBarcodeFormatAztec";
        if (t.includes("128")) return "PKBarcodeFormatCode128";

        return "PKBarcodeFormatQR";
      }

      // ------------------------------------------------------------
      // content (template + customer override)
      // ------------------------------------------------------------
      const baseContent = normalizeCardContent({
        headline: template?.headline ?? "",
        subheadline: template?.subheadline ?? "",
        openingHours: template?.openingHours ?? "",
        customMessage: template?.customMessage ?? "",
        websiteUrl: template?.websiteUrl ?? "",
        themeVariant: template?.themeVariant ?? "classic",
        primaryColor: template?.primaryColor ?? "#FF9900",
        secondaryColor: template?.secondaryColor ?? "#111827",
      });

      const customerContent = normalizeCardContent(customer?.cardContent || {});

      const finalContent = {
        headline: pickNonEmpty(customerContent.headline, baseContent.headline),
        subheadline: pickNonEmpty(customerContent.subheadline, baseContent.subheadline),
        openingHours: pickNonEmpty(customerContent.openingHours, baseContent.openingHours),
        customMessage: pickNonEmpty(customerContent.customMessage, baseContent.customMessage),
        websiteUrl: pickNonEmpty(customerContent.websiteUrl, baseContent.websiteUrl),
        themeVariant: pickNonEmpty(customerContent.themeVariant, baseContent.themeVariant),
        primaryColor: pickNonEmpty(customerContent.primaryColor, baseContent.primaryColor),
        secondaryColor: pickNonEmpty(customerContent.secondaryColor, baseContent.secondaryColor),
      };

      // ------------------------------------------------------------
      // program / rules
      // ------------------------------------------------------------
      const cardType = card?.type ?? template?.cardType ?? "stamps";

      const freeStampsToReward =
        template?.rules?.freeStampsToReward ?? template?.freeStampsToReward ?? 10;

      const redeemFormat = template?.rules?.redeemFormat ?? "qr";
      const barcodeType = template?.rules?.barcodeType ?? "code128";

      // ------------------------------------------------------------
      // Redeem selection (reward → coupon)
      // ------------------------------------------------------------
      const now = new Date();
      const activeRedeem = pickRedeemForDisplay(card, now);

      const redeemCodeRaw =
        activeRedeem && typeof activeRedeem.code === "string"
          ? activeRedeem.code.trim()
          : null;

      const redeemPurpose = activeRedeem?.purpose ?? null;

      // dostupnost podle purpose
      const redeemAvailable =
        redeemPurpose === "reward"
          ? Boolean(redeemCodeRaw) && (card.rewards ?? 0) > 0
          : redeemPurpose === "coupon"
          ? Boolean(redeemCodeRaw)
          : false;

      const redeemCode = redeemAvailable ? redeemCodeRaw : null;

      // ------------------------------------------------------------
      // PassKit-ready projekce
      // ------------------------------------------------------------
      const passBarcode =
        redeemAvailable && redeemCode
          ? {
              format: mapToPKBarcodeFormat(redeemFormat, barcodeType),
              message: redeemCode,
              messageEncoding: "iso-8859-1",
              altText:
                redeemPurpose === "reward"
                  ? "Odměna dostupná ✅"
                  : "Kód k uplatnění ✅",
            }
          : null;

      const passDisplay = redeemAvailable
        ? {
            badge:
              redeemPurpose === "reward"
                ? "Odměna dostupná ✅"
                : "Kupón dostupný ✅",
            instruction: "Ukažte u pokladny",
          }
        : {
            badge: null,
            instruction: null,
          };

      const payload = {
        // -------------------------
        // v1 kontrakt
        // -------------------------
        version: 1,

        cardId: String(card._id),
        merchantId: card.merchantId ?? null,
        customerId: card.customerId ?? null,
        customerName: customer?.name ?? null,

        program: {
          cardType,
          programName: template?.programName ?? "",
          rules: cardType === "stamps" ? { freeStampsToReward } : {},
        },

        state: {
          stamps: card.stamps ?? 0,
          rewards: card.rewards ?? 0,
        },

        redeem: {
          available: redeemAvailable,
          code: redeemCode,
          purpose: redeemPurpose,
          format: redeemFormat,
          barcodeType,
        },

        pass: {
          barcode: passBarcode,
          display: passDisplay,
        },

        content: {
          headline: finalContent.headline,
          subheadline: finalContent.subheadline,
          openingHours: finalContent.openingHours,
          customMessage: finalContent.customMessage,
          websiteUrl: finalContent.websiteUrl,
          lastUpdatedAt:
            customer?.cardContent?.lastUpdatedAt || template?.updatedAt || null,
        },

        theme: {
          variant: finalContent.themeVariant,
          primaryColor: finalContent.primaryColor,
          secondaryColor: finalContent.secondaryColor,
          logoUrl: customer?.settings?.logoUrl || template?.logoUrl || null,
        },

        // -------------------------
        // LEGACY
        // -------------------------
        stamps: card.stamps ?? 0,
        rewards: card.rewards ?? 0,

        cardType,
        freeStampsToReward,

        redeemCode,
        redeemFormat,
        barcodeType,

        headline: finalContent.headline,
        subheadline: finalContent.subheadline,
        openingHours: finalContent.openingHours,
        customMessage: finalContent.customMessage,
        websiteUrl: finalContent.websiteUrl,

        themeColor: finalContent.primaryColor,
        themeVariant: finalContent.themeVariant,
        primaryColor: finalContent.primaryColor,
        secondaryColor: finalContent.secondaryColor,

        logoUrl: customer?.settings?.logoUrl || template?.logoUrl || null,
        lastUpdatedAt:
          customer?.cardContent?.lastUpdatedAt || template?.updatedAt || null,
      };

      return reply.send(payload);
    } catch (err) {
      request.log.error(err, "Error fetching public card data");
      return reply.code(500).send({ error: "Error fetching public card data" });
    }
  });


  /**
   * POST /api/cards/:id/redeem
   * Uplatní redeem kód (scan / barcode / QR)
   * Body: { code: "PX-...." }
   *
   * ✅ Respektuje aktivní program z CardTemplate (globálně pro merchanta)
   * ✅ Podporuje:
   *    - stamps/reward: odečte 1 reward + označí redeemCode jako redeemed
   *    - coupon: pouze označí redeemCode jako redeemed (bez rewards)
   * ������ Pouze pro přihlášeného merchanta a jen na jeho kartě.
   *
   * ✅ NOVĚ:
   * - rozhoduje podle redeemCode.purpose ("reward" | "coupon"), ne podle card.type
   * - dovoluje mít na jedné kartě aktivní reward i coupon (jiné kódy)
   * - respektuje validTo (expirace)
   */
  fastify.post("/api/cards/:id/redeem", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const { id } = request.params;
      const merchantId = userId;

      const codeRaw = request.body?.code;
      const code = typeof codeRaw === "string" ? codeRaw.trim() : "";

      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      const card = await Card.findOne({ _id: id, merchantId });
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      // globální template pro merchanta (zatím necháváme kvůli programName/rules apod.)
      const template = await CardTemplate.findOne({ merchantId }).lean();
      const activeCardType = template?.cardType ?? "stamps";

      // (informativně) efektivní typ karty: primárně card.type, jinak template
      // Pozn.: už to nepoužíváme k rozhodnutí o redeem, protože redeem je řízen purpose kódu.
      const effectiveCardType = card.type ?? activeCardType;

      // Pokud by někdy došlo k rozjezdu, zaloguj (NEBLOKUJ 409),
      // protože coupon redeem může existovat i když je aktivní program "stamps".
      if (card.type && activeCardType && card.type !== activeCardType) {
        request.log.warn(
          { cardType: card.type, activeCardType, cardId: String(card._id) },
          "Card type differs from active template program (non-blocking)"
        );
      }

      // validace redeemCodes
      if (!Array.isArray(card.redeemCodes) || card.redeemCodes.length === 0) {
        return reply.code(400).send({ error: "No redeem codes available" });
      }

      const now = new Date();

      // najdi aktivní redeem kód podle code + status + (validTo)
      const idx = card.redeemCodes.findIndex((x) => {
        if (!x) return false;
        if (x.status !== "active") return false;
        if (typeof x.code !== "string") return false;
        if (x.code.trim() !== code) return false;
        if (x.validTo && new Date(x.validTo) <= now) return false;
        return true;
      });

      if (idx === -1) {
        return reply
          .code(400)
          .send({ error: "Invalid, expired, or already redeemed code" });
      }

      const redeem = card.redeemCodes[idx];
      const purpose = redeem.purpose || "reward"; // backward compatible pro staré záznamy

      // ------------------------------------------------------------
      // REWARD: musí existovat reward a při redeem se odečte
      // ------------------------------------------------------------
      if (purpose === "reward") {
        const currentRewards = card.rewards || 0;
        if (currentRewards < 1) {
          return reply.code(400).send({ error: "No rewards available" });
        }

        card.redeemCodes[idx].status = "redeemed";
        card.redeemCodes[idx].redeemedAt = now;

        card.rewards = currentRewards - 1;
        card.lastEventAt = now;

        await card.save();

        await CardEvent.create({
          merchantId,
          cardId: card._id,
          walletToken: card.walletToken,
          type: "REWARD_REDEEMED",
          deltaStamps: 0,
          deltaRewards: -1,
          cardType: effectiveCardType, // info field (neřídí logiku)
          templateId: card.templateId ?? null,
          actor: {
            type: "merchant",
            actorId: merchantId,
            source: "merchant-app",
          },
          payload: { code, purpose: "reward" },
        });

        return reply.send(card);
      }

      // ------------------------------------------------------------
      // COUPON: pouze označit kód jako redeemed (bez rewards)
      // ------------------------------------------------------------
      if (purpose === "coupon") {
        card.redeemCodes[idx].status = "redeemed";
        card.redeemCodes[idx].redeemedAt = now;

        card.lastEventAt = now;

        await card.save();

        await CardEvent.create({
          merchantId,
          cardId: card._id,
          walletToken: card.walletToken,
          type: "COUPON_REDEEMED",
          deltaStamps: 0,
          deltaRewards: 0,
          cardType: effectiveCardType, // info field (neřídí logiku)
          templateId: card.templateId ?? null,
          actor: {
            type: "merchant",
            actorId: merchantId,
            source: "merchant-app",
          },
          payload: { code, purpose: "coupon", meta: redeem.meta ?? null },
        });

        return reply.send(card);
      }

      // ------------------------------------------------------------
      // Ostatní purpose zatím nepodporujeme
      // ------------------------------------------------------------
      return reply.code(409).send({
        error: "Redeem purpose not supported",
        purpose,
      });
    } catch (err) {
      request.log.error(err, "Error redeeming code");
      return reply.code(500).send({ error: "Error redeeming code" });
    }
  });
}


export default cardRoutes;

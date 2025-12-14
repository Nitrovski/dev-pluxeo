// src/routes/card.routes.js
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";
import { getAuth } from "@clerk/fastify";
import crypto from "crypto";
import { CardEvent } from "../models/cardEvent.model.js";
import { normalizeCardContent } from "../utils/normalizeCardContent.js";


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
        template?.rules?.freeStampsToReward ?? template?.freeStampsToReward ?? 10;
      const threshold =
        Number.isInteger(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 10;

      let newStamps = (card.stamps || 0) + amount;
      let newRewards = card.rewards || 0;

      while (newStamps >= threshold) {
        newRewards += 1;
        newStamps -= threshold;
      }

      const prevRewards = card.rewards || 0;
      const rewardDelta = newRewards - prevRewards;

      // ✅ vytvoř redeem kódy pro nově získané odměny
      if (rewardDelta > 0) {
        if (!Array.isArray(card.redeemCodes)) card.redeemCodes = [];
        const existing = new Set(card.redeemCodes.map((x) => x.code));

        for (let i = 0; i < rewardDelta; i++) {
          let code = generateRedeemCode();
          while (existing.has(code)) code = generateRedeemCode();
          existing.add(code);

          card.redeemCodes.push({
            code,
            status: "active",
            createdAt: new Date(),
          });
        }
      }

      card.stamps = newStamps;
      card.rewards = newRewards;
      card.lastEventAt = new Date();

      await card.save();

      // event: přidání razítka
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
        },
      });

      // event: odměna získána
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
            redeemCodesIssued: rewardDelta,
          },
        });
      }

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

      // base z template
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

      // override z customer
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

      // program / rules z template
      const cardType = template?.cardType ?? "stamps";
      const freeStampsToReward =
        template?.rules?.freeStampsToReward ?? template?.freeStampsToReward ?? 10;

      const redeemFormat = template?.rules?.redeemFormat ?? "qr";
      const barcodeType = template?.rules?.barcodeType ?? "code128";

      // vyber první aktivní redeem kód
      const activeRedeem =
        Array.isArray(card.redeemCodes)
          ? card.redeemCodes.find((x) => x?.status === "active" && x?.code)
          : null;

      const redeemCode = activeRedeem?.code ?? null;
      const redeemAvailable = Boolean(redeemCode) && (card.rewards ?? 0) > 0;

      const payload = {
        // -------------------------
        // ✅ v1 kontrakt (nový)
        // -------------------------
        version: 1,

        cardId: String(card._id),
        merchantId: card.merchantId ?? null,
        customerId: card.customerId ?? null,
        customerName: customer?.name ?? null,

        program: {
          cardType,
          programName: template?.programName ?? "",
          rules: {
            freeStampsToReward,
          },
        },

        state: {
          stamps: card.stamps ?? 0,
          rewards: card.rewards ?? 0,
        },

        redeem: {
          available: redeemAvailable,
          code: redeemCode,
          format: redeemFormat,
          barcodeType,
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
        // ✅ LEGACY (dočasně)
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
   * Uplatní 1 odměnu přes redeem kód (scan / barcode / QR)
   * Body: { code: "PX-...." }
   *
   * ✅ Respektuje aktivní program z CardTemplate (globálně pro merchanta)
   * ������ Pouze pro přihlášeného merchanta a jen na jeho kartě.
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

      const template = await CardTemplate.findOne({ merchantId }).lean();
      const activeCardType = template?.cardType ?? "stamps";

      if (activeCardType !== "stamps") {
        return reply.code(409).send({
          error: "Active program is not stamps",
          cardType: activeCardType,
        });
      }

      const currentRewards = card.rewards || 0;
      if (currentRewards < 1) {
        return reply.code(400).send({ error: "No rewards available" });
      }

      if (!Array.isArray(card.redeemCodes) || card.redeemCodes.length === 0) {
        return reply.code(400).send({ error: "No redeem codes available" });
      }

      const idx = card.redeemCodes.findIndex(
        (x) => x?.status === "active" && x?.code === code
      );

      if (idx === -1) {
        return reply
          .code(400)
          .send({ error: "Invalid or already redeemed code" });
      }

      // uplatni kód + odečti reward
      card.redeemCodes[idx].status = "redeemed";
      card.redeemCodes[idx].redeemedAt = new Date();

      card.rewards = currentRewards - 1;
      card.lastEventAt = new Date();

      await card.save();

      await CardEvent.create({
        merchantId,
        cardId: card._id,
        walletToken: card.walletToken,
        type: "REWARD_REDEEMED",
        deltaStamps: 0,
        deltaRewards: -1,
        cardType: activeCardType,
        templateId: card.templateId ?? null,
        actor: {
          type: "merchant",
          actorId: merchantId,
          source: "merchant-app",
        },
        payload: {
          code,
        },
      });

      return reply.send(card);
    } catch (err) {
      request.log.error(err, "Error redeeming reward");
      return reply.code(500).send({ error: "Error redeeming reward" });
    }
  });
}

export default cardRoutes;

import { getAuth } from "@clerk/fastify";
import crypto from "crypto";
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { issueRedeemCode } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { buildCardEventPayload } from "../lib/eventSchemas.js";
import { syncGoogleWalletObject } from "../lib/googleWalletPass.js";

function normToken(v) {
  return String(v || "").trim();
}

// Anti double-scan protection (MVP)
// 1 stamp / 1 min
const STAMP_COOLDOWN_MS = 60_000;

// scan-friendly: PX-XXXX-XXXX-XXXX
function generateRedeemCode() {
  const raw = crypto.randomBytes(8).toString("base64url").toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `PX-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

// zkus najít freeStampsToReward na více místech (podle toho, jak to má uloené)
function resolveThreshold(customerDoc) {
  const candidates = [
    customerDoc?.cardTemplate?.freeStampsToReward,
    customerDoc?.settings?.cardTemplate?.freeStampsToReward,
    customerDoc?.settings?.template?.freeStampsToReward,
    customerDoc?.settings?.activeTemplate?.freeStampsToReward,
  ];

  // dovolíme i string "10"
  for (const x of candidates) {
    const n = Number(x);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }

  return 10;
}

export async function merchantStampRoutes(fastify) {
  fastify.post("/api/merchant/stamp", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const token = normToken(
        request.body?.code || request.body?.token || request.body?.walletToken
      );

      if (!token) {
        return reply.code(400).send({ error: "code (walletToken) is required" });
      }

      // 1) Najdi kartu podle merchantId + walletToken
      const card = await Card.findOne({ merchantId, walletToken: token });
      if (!card) return reply.code(404).send({ error: "card not found" });

      // 2) anti double-scan guard (server-side pojistka)
      const nowMs = Date.now();
      if (card.lastEventAt) {
        const diff = nowMs - new Date(card.lastEventAt).getTime();
        if (diff >= 0 && diff < STAMP_COOLDOWN_MS) {
          return reply.code(429).send({
            error: "stamp throttled",
            retryAfterMs: STAMP_COOLDOWN_MS - diff,
          });
        }
      }

      // 3) threshold z Customer nastavení (nebo fallback)
      const customerDoc = await Customer.findOne({ merchantId });
      const threshold = resolveThreshold(customerDoc);

      // 4) STAMPS = progress (0..threshold-1)
      //    Pri dosaení threshold se odecte (reset/progress) a pricte reward.
      const prevStamps = Number(card.stamps || 0);
      const prevRewards = Number(card.rewards || 0);

      let newStamps = prevStamps + 1;
      let newRewards = prevRewards;

      while (newStamps >= threshold) {
        newStamps -= threshold; // ?? spotrebuj razítka pri vzniku odmeny
        newRewards += 1;
      }

      const rewardDelta = newRewards - prevRewards;

      card.stamps = newStamps;
      card.rewards = newRewards;

      // Pokud vznikla alespon jedna odmena, vystav 1 aktivní reward redeem code
      if (rewardDelta > 0) {
        issueRedeemCode(card, {
          code: generateRedeemCode(),
          purpose: "reward",
          validTo: null,
          meta: {
            source: "stamp",
            threshold,
            earned: rewardDelta,
          },
          rotateStrategy: "expireAndIssue",
        });
      }

      // zaznamenáme poslední stamp event (pro rate-limit)
      card.lastEventAt = new Date(nowMs);

      await card.save();

      await CardEvent.create(
        buildCardEventPayload({
          merchantId,
          cardId: card._id,
          walletToken: card.walletToken,
          type: "STAMP_ADDED",
          deltaStamps: 1,
          deltaRewards: rewardDelta,
          cardType: card.type ?? "stamps",
          templateId: card.templateId ?? null,
          actor: { type: "merchant", actorId: merchantId, source: "merchant-app" },
          payload: {
            threshold,
            rewardDelta,
            stamps: card.stamps,
            rewards: card.rewards,
          },
        })
      );

      await syncGoogleWalletObject(String(card._id), request.log);

      // 5) vrat updated public payload
      const publicPayload = await buildPublicCardPayload(String(card._id));

      return reply.send({
        ok: true,
        stamped: {
          added: 1,
          threshold,
          rewardDelta,
          stamps: card.stamps,
          rewards: card.rewards,
        },
        card: {
          cardId: String(card._id),
          customerId: card.customerId,
          stamps: card.stamps,
          rewards: card.rewards,
        },
        public: publicPayload,
      });
    } catch (err) {
      request.log?.error?.(err, "merchant stamp failed");
      return reply.code(500).send({ error: err?.message || "stamp failed" });
    }
  });
}

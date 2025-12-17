import { getAuth } from "@clerk/fastify";
import crypto from "crypto";
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { issueRedeemCode } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";

function normToken(v) {
  return String(v || "").trim();
}

// ?? Anti double-scan protection (MVP)
// ZDE nastavuješ, jak casto muže merchant pridat razítko na jednu kartu.
// Napr. 60_000 = max 1 stamp za 1 minutu.
const STAMP_COOLDOWN_MS = 60_000; // 1 stamp / 1 min

// scan-friendly: PX-XXXX-XXXX-XXXX
function generateRedeemCode() {
  const raw = crypto.randomBytes(8).toString("base64url").toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `PX-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

// zkus najít freeStampsToReward na více místech (podle toho, jak to máš uložené)
function resolveThreshold(customerDoc) {
  const candidates = [
    customerDoc?.cardTemplate?.freeStampsToReward,
    customerDoc?.settings?.cardTemplate?.freeStampsToReward,
    customerDoc?.settings?.template?.freeStampsToReward,
    customerDoc?.settings?.activeTemplate?.freeStampsToReward,
  ];

  const n = Number(candidates.find((x) => Number.isFinite(Number(x))));
  return Number.isFinite(n) && n > 0 ? n : 10; // fallback 10 (jen pro MVP)
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

      // 1) najdi kartu podle walletTokenu
      const card = await Card.findOne({ walletToken: token });
      if (!card) return reply.code(404).send({ error: "card not found" });

      // 2) ownership check
      if (card.merchantId !== merchantId) {
        return reply.code(404).send({ error: "card not found" }); // schválne 404 (neprozrazuj existenci)
      }

      // 2.5) anti double-scan guard (server-side pojistka)
      // Pokud nekdo omylem / bugem pošle více requestu (kamera, HW scanner),
      // tak dovolíme max 1 stamp za STAMP_COOLDOWN_MS.
      const nowMs = Date.now();
      if (card.lastEventAt) {
        const diff = nowMs - new Date(card.lastEventAt).getTime();
        if (diff < STAMP_COOLDOWN_MS) {
          return reply.code(429).send({
            error: "stamp throttled",
            retryAfterMs: STAMP_COOLDOWN_MS - diff,
          });
        }
      }

      // 3) zjisti threshold z Customer nastavení (nebo fallback)
      const customerDoc = await Customer.findOne({ merchantId });
      const threshold = resolveThreshold(customerDoc);

      // 4) stamp + prípadne reward issue
      const prevStamps = Number(card.stamps || 0);
      const nextStamps = prevStamps + 1;
      card.stamps = nextStamps;

      // každých "threshold" razítek -> +1 reward + issue redeemCode
      const crossed =
        Math.floor(nextStamps / threshold) - Math.floor(prevStamps / threshold);
      let rewardDelta = 0;

      if (crossed > 0) {
        rewardDelta = crossed;
        card.rewards = Number(card.rewards || 0) + rewardDelta;

        // vydáme/rotujeme redeemCode pro reward (1 aktivní)
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

      // 5) vrat updated public payload
      const publicPayload = await buildPublicCardPayload(card._id);

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
      return reply.code(500).send({ error: err?.message || "stamp failed" });
    }
  });
}

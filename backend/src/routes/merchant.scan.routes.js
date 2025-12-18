import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { redeemByCodeForMerchant } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";

function normCode(v) {
  return String(v || "").trim().toUpperCase();
}

// Varianta bez pomlcek / mezer / všeho co není A-Z0-9
function normCodeAlnum(v) {
  return normCode(v).replace(/[^A-Z0-9]/g, "");
}

// ?? Anti double-scan protection (MVP)
// 1 redeem max za 5s (per card)
const REDEEM_COOLDOWN_MS = 5_000;

function findRedeemedAtFromCard(card, codeUpperOrNorm) {
  if (!card?.redeemCodes || !Array.isArray(card.redeemCodes)) return null;

  const target = String(codeUpperOrNorm || "").trim().toUpperCase();
  const targetNorm = target.replace(/[^A-Z0-9]/g, "");

  const rc = card.redeemCodes.find((x) => {
    const c = typeof x?.code === "string" ? x.code.trim().toUpperCase() : "";
    const cNorm = c.replace(/[^A-Z0-9]/g, "");
    return c === target || cNorm === targetNorm;
  });

  const dt = rc?.redeemedAt ? new Date(rc.redeemedAt) : null;
  return dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
}

export async function merchantScanRoutes(fastify) {
  fastify.post("/api/merchant/scan", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const raw = request.body?.code;
      const code = normCode(raw);
      const codeAlt = normCodeAlnum(raw);

      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      // kandidáti pro match (nekteré scannery posílají bez pomlcek, s mezerou atd.)
      const codeCandidates = Array.from(
        new Set([code, codeAlt].filter(Boolean))
      );

      // (volitelná) rychlá pre-check pojistka: cooldown pres lastEventAt
      const preCard = await Card.findOne(
        { merchantId, "redeemCodes.code": { $in: codeCandidates } },
        { lastEventAt: 1 }
      );

      if (preCard?.lastEventAt) {
        const nowMs = Date.now();
        const diff = nowMs - new Date(preCard.lastEventAt).getTime();
        if (diff < REDEEM_COOLDOWN_MS) {
          return reply.code(429).send({
            error: "redeem throttled",
            retryAfterMs: REDEEM_COOLDOWN_MS - diff,
          });
        }
      }

      // 1) Redeem podle kódu (helper najde kartu a vyreší reward/coupon + eventy)
      let res = null;
      let usedCode = codeCandidates[0];

      // zkus postupne kandidáty (první bývá presný formát z QR)
      for (const c of codeCandidates) {
        usedCode = c;

        // eslint-disable-next-line no-await-in-loop
        res = await redeemByCodeForMerchant({
          Card,
          CardEvent,
          merchantId,
          code: c,
          source: "merchant_scan",
          actorId: merchantId,
        });

        if (res?.ok) break;
      }

      if (!res?.ok) {
        return reply
          .code(res?.status || 400)
          .send({ error: res?.error || "redeem failed" });
      }

      const updatedCard = res.card;

      // 2) Updated public payload (vybere 1 aktivní redeem dle priority reward?coupon)
      const publicPayload = await buildPublicCardPayload(String(updatedCard._id));

      // 3) redeemedAt ideálne z uloženého redeemCodes záznamu (ne “now”)
      const redeemedAt =
        findRedeemedAtFromCard(updatedCard, res.code || usedCode) ||
        new Date().toISOString();

      return reply.send({
        ok: true,
        redeemed: {
          code: res.code || usedCode,
          purpose: res.purpose,
          redeemedAt,
        },
        card: {
          cardId: String(updatedCard._id),
          customerId: updatedCard.customerId ?? null,
          stamps: updatedCard.stamps ?? 0,
          rewards: updatedCard.rewards ?? 0,
        },
        public: publicPayload,
      });
    } catch (err) {
      request.log.error(err, "merchant scan failed");
      return reply.code(500).send({ error: "scan failed" });
    }
  });
}

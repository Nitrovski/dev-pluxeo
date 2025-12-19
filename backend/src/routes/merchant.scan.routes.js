import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { redeemByCodeForMerchant } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function normCode(v) {
  return String(v || "").trim().toUpperCase();
}

function normCodeAlnum(v) {
  return normCode(v).replace(/[^A-Z0-9]/g, "");
}

// Anti double-scan protection (MVP)
// 1 redeem max za 5s (per card)
const REDEEM_COOLDOWN_MS = 5_000;

function findRedeemedAtFromCard(card, codeUpperOrNorm) {
  if (!Array.isArray(card?.redeemCodes)) return null;

  const target = normCode(codeUpperOrNorm);
  const targetNorm = target.replace(/[^A-Z0-9]/g, "");

  const rc = card.redeemCodes.find((x) => {
    if (!x?.code) return false;
    const c = normCode(x.code);
    const cNorm = c.replace(/[^A-Z0-9]/g, "");
    return c === target || cNorm === targetNorm;
  });

  const dt = rc?.redeemedAt ? new Date(rc.redeemedAt) : null;
  return dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
}

/* ------------------------------------------------------------------ */
/* Route                                                              */
/* ------------------------------------------------------------------ */

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

      // kandidáti pro match (ruzné QR formáty)
      const codeCandidates = Array.from(
        new Set([code, codeAlt].filter(Boolean))
      );

      /* ------------------------------------------------------------ */
      /* Pre-check cooldown (rychlá pojistka)                          */
      /* ------------------------------------------------------------ */
      const preCard = await Card.findOne(
        { merchantId, "redeemCodes.code": { $in: codeCandidates } },
        { lastEventAt: 1 }
      );

      if (preCard?.lastEventAt) {
        const diff = Date.now() - new Date(preCard.lastEventAt).getTime();
        if (diff >= 0 && diff < REDEEM_COOLDOWN_MS) {
          return reply.code(429).send({
            error: "redeem throttled",
            retryAfterMs: REDEEM_COOLDOWN_MS - diff,
          });
        }
      }

      /* ------------------------------------------------------------ */
      /* Redeem (reward / coupon)                                     */
      /* ------------------------------------------------------------ */
      let res = null;
      let usedCode = codeCandidates[0];

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

      if (!res || res.ok !== true || !res.card) {
        return reply
          .code(res?.status || 400)
          .send({ error: res?.error || "redeem failed" });
      }

      const updatedCard = res.card;

      /* ------------------------------------------------------------ */
      /* Public payload (wallet view)                                 */
      /* ------------------------------------------------------------ */
      const publicPayload = await buildPublicCardPayload(
        String(updatedCard._id)
      );

      /* ------------------------------------------------------------ */
      /* redeemedAt – ideálne z DB                                    */
      /* ------------------------------------------------------------ */
      const redeemedAt =
        findRedeemedAtFromCard(updatedCard, res.code || usedCode) ||
        new Date().toISOString();

      /* ------------------------------------------------------------ */
      /* Response                                                     */
      /* ------------------------------------------------------------ */
      return reply.send({
        ok: true,

        redeemed: {
          code: res.code || usedCode,
          purpose: res.purpose, // reward | coupon
          redeemedAt,
          couponMeta: res.purpose === "coupon" ? res.meta ?? null : null,
        },

        card: {
          cardId: String(updatedCard._id),
          customerId: updatedCard.customerId ?? null,
          stamps: Number(updatedCard.stamps || 0),
          rewards: Number(updatedCard.rewards || 0),
        },

        public: publicPayload,
      });
    } catch (err) {
      request.log.error(
        { err, stack: err?.stack },
        "merchant scan failed"
      );
      return reply.code(500).send({
        error: err?.message || "scan failed",
      });
    }
  });
}

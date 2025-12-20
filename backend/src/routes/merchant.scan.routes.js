import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { ScanEvent } from "../models/scanEvent.model.js";
import { redeemByCodeForMerchant } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";
import { ScanFailureReasons } from "../constants/scanFailureReasons.js";
import { buildScanEventPayload } from "../lib/eventSchemas.js";
import { syncGoogleWalletObject } from "../lib/googleWalletPass.js";

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

async function recordScanEvent(
  request,
  { merchantId = null, cardId = null, code = null, status, reason = null, payload = {} }
) {
  try {
    await ScanEvent.create(
      buildScanEventPayload({
        merchantId,
        cardId,
        code,
        status,
        reason,
        payload: { ...payload, reason },
      })
    );
  } catch (err) {
    request?.log?.error?.({ err, status, reason }, "scan event persist failed");
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                              */
/* ------------------------------------------------------------------ */

export async function merchantScanRoutes(fastify) {
  fastify.post("/api/merchant/scan", async (request, reply) => {
    let merchantId = null;
    let lastCardId = null;
    const raw = request.body?.code;

    const respondWithFailure = async (status, reason, body = {}) => {
      await recordScanEvent(request, {
        merchantId,
        cardId: lastCardId,
        code: raw,
        status: "failure",
        reason,
        payload: { status, ...body },
      });

      return reply.code(status).send(body);
    };

    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return respondWithFailure(401, ScanFailureReasons.AUTHENTICATION, {
          error: "Missing or invalid token",
        });
      }

      merchantId = userId;

      const code = normCode(raw);
      const codeAlt = normCodeAlnum(raw);

      if (!code) {
        return respondWithFailure(400, ScanFailureReasons.CODE_MISSING, {
          error: "code is required",
        });
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
        lastCardId = preCard._id;
        const diff = Date.now() - new Date(preCard.lastEventAt).getTime();
        if (diff >= 0 && diff < REDEEM_COOLDOWN_MS) {
          return respondWithFailure(429, ScanFailureReasons.RATE_LIMITED, {
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
        if (res?.card?._id) lastCardId = res.card._id;

        const status = res?.status || 400;
        return respondWithFailure(status, res?.reason || ScanFailureReasons.REDEEM_FAILED, {
          error: res?.error || "redeem failed",
        });
      }

      const updatedCard = res.card;
      lastCardId = updatedCard._id;

      /* ------------------------------------------------------------ */
      /* Public payload (wallet view)                                 */
      /* ------------------------------------------------------------ */
      await syncGoogleWalletObject(String(updatedCard._id), request.log);

      const publicPayload = await buildPublicCardPayload(
        String(updatedCard._id)
      );

      /* ------------------------------------------------------------ */
      /* redeemedAt  ideálne z DB                                    */
      /* ------------------------------------------------------------ */
      const redeemedAt =
        findRedeemedAtFromCard(updatedCard, res.code || usedCode) ||
        new Date().toISOString();

      await recordScanEvent(request, {
        merchantId,
        cardId: lastCardId,
        code: res.code || usedCode,
        status: "success",
        payload: {
          purpose: res.purpose,
          redeemedAt,
          cardType: updatedCard.type ?? "stamps",
        },
      });

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
      await recordScanEvent(request, {
        merchantId,
        cardId: lastCardId,
        code: raw,
        status: "failure",
        reason: ScanFailureReasons.INTERNAL_ERROR,
        payload: { error: err?.message || "scan failed" },
      });

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

import { getAuth } from "@clerk/fastify";
import crypto from "crypto";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { Customer } from "../models/customer.model.js";
import { ScanEvent } from "../models/scanEvent.model.js";
import { issueRedeemCode, redeemByCodeForMerchant } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";
import { ScanFailureReasons } from "../constants/scanFailureReasons.js";
import { buildCardEventPayload, buildScanEventPayload } from "../lib/eventSchemas.js";
import { ensureLoyaltyObjectForCard } from "../lib/googleWalletPass.js";

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
// 1 stamp / 1 min
const STAMP_COOLDOWN_MS = 60_000;

// Anti double-scan protection (MVP)
// 1 redeem max za 5s (per card)
const REDEEM_COOLDOWN_MS = 5_000;

// scan-friendly: PX-XXXX-XXXX-XXXX
function generateRedeemCode() {
  const raw = crypto.randomBytes(8).toString("base64url").toUpperCase();
  const clean = raw.replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `PX-${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

// zkus najít freeStampsToReward na více místech (podle toho, jak to má uloené)
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

async function syncWalletForCard(cardId, request) {
  try {
    await ensureLoyaltyObjectForCard({ cardId });
  } catch (err) {
    request?.log?.warn?.({ err, cardId }, "google wallet ensure failed");
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
      /* Redeem (reward / coupon)                                     */
      /* ------------------------------------------------------------ */
      const redeemCard = await Card.findOne({
        "redeemCodes.code": { $in: codeCandidates },
      });

      if (redeemCard) {
        lastCardId = redeemCard._id;

        if (String(redeemCard.merchantId) !== merchantId) {
          return respondWithFailure(403, ScanFailureReasons.CODE_NOT_FOUND, {
            error: "code not found for merchant",
          });
        }

        if (redeemCard.lastEventAt) {
          const diff = Date.now() - new Date(redeemCard.lastEventAt).getTime();
          if (diff >= 0 && diff < REDEEM_COOLDOWN_MS) {
            return respondWithFailure(429, ScanFailureReasons.RATE_LIMITED, {
              error: "redeem throttled",
              retryAfterMs: REDEEM_COOLDOWN_MS - diff,
            });
          }
        }

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
          return respondWithFailure(
            status,
            res?.reason || ScanFailureReasons.REDEEM_FAILED,
            {
              error: res?.error || "redeem failed",
            }
          );
        }

        const updatedCard = res.card;
        lastCardId = updatedCard._id;

        await syncWalletForCard(String(updatedCard._id), request);

        const publicPayload = await buildPublicCardPayload(
          String(updatedCard._id)
        );

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
      }

      /* ------------------------------------------------------------ */
      /* Stamps via scanCode                                           */
      /* ------------------------------------------------------------ */
      const scanCard = await Card.findOne({ scanCode: { $in: codeCandidates } });

      if (!scanCard) {
        return respondWithFailure(404, ScanFailureReasons.CODE_NOT_FOUND, {
          error: "Card not found for code",
        });
      }

      lastCardId = scanCard._id;

      if (String(scanCard.merchantId) !== merchantId) {
        return respondWithFailure(403, ScanFailureReasons.CODE_NOT_FOUND, {
          error: "code not found for merchant",
        });
      }

      const nowMs = Date.now();
      if (scanCard.lastEventAt) {
        const diff = nowMs - new Date(scanCard.lastEventAt).getTime();
        if (diff >= 0 && diff < STAMP_COOLDOWN_MS) {
          return respondWithFailure(429, ScanFailureReasons.RATE_LIMITED, {
            error: "stamp throttled",
            retryAfterMs: STAMP_COOLDOWN_MS - diff,
          });
        }
      }

      const customerDoc = await Customer.findOne({ merchantId });
      const threshold = resolveThreshold(customerDoc);

      const prevStamps = Number(scanCard.stamps || 0);
      const prevRewards = Number(scanCard.rewards || 0);

      let newStamps = prevStamps + 1;
      let newRewards = prevRewards;

      while (newStamps >= threshold) {
        newStamps -= threshold;
        newRewards += 1;
      }

      const rewardDelta = newRewards - prevRewards;

      scanCard.stamps = newStamps;
      scanCard.rewards = newRewards;
      scanCard.lastEventAt = new Date(nowMs);

      if (rewardDelta > 0) {
        issueRedeemCode(scanCard, {
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

      await scanCard.save();

      await CardEvent.create(
        buildCardEventPayload({
          merchantId,
          cardId: scanCard._id,
          walletToken: scanCard.walletToken,
          type: "STAMP_ADDED",
          deltaStamps: 1,
          deltaRewards: rewardDelta,
          cardType: scanCard.type ?? "stamps",
          templateId: scanCard.templateId ?? null,
          actor: { type: "merchant", actorId: merchantId, source: "merchant-app" },
          payload: {
            threshold,
            rewardDelta,
            stamps: scanCard.stamps,
            rewards: scanCard.rewards,
          },
        })
      );

      await syncWalletForCard(String(scanCard._id), request);

      const publicPayload = await buildPublicCardPayload(String(scanCard._id));

      await recordScanEvent(request, {
        merchantId,
        cardId: lastCardId,
        code,
        status: "success",
        payload: {
          purpose: "stamp",
          cardType: scanCard.type ?? "stamps",
          threshold,
        },
      });

      return reply.send({
        ok: true,
        stamped: {
          added: 1,
          threshold,
          rewardDelta,
          stamps: scanCard.stamps,
          rewards: scanCard.rewards,
        },
        card: {
          cardId: String(scanCard._id),
          customerId: scanCard.customerId,
          stamps: scanCard.stamps,
          rewards: scanCard.rewards,
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

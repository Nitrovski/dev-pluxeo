import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { redeemByCodeForMerchant } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";

function normCode(v) {
  return String(v || "").trim().toUpperCase();
}

// ?? Anti double-scan protection (MVP)
// ZDE nastavuješ ochranu proti opakovanému uplatnení pri “dvojitém” nactení / kliknutí.
// Doporucení: pár sekund stací (redeem se stejne po prvním uplatnení zneaktivní).
const REDEEM_COOLDOWN_MS = 5_000; // 1 redeem max za 5s (per card)

function findRedeemedAtFromCard(card, codeUpper) {
  if (!card?.redeemCodes || !Array.isArray(card.redeemCodes)) return null;

  const rc = card.redeemCodes.find((x) => {
    const c = typeof x?.code === "string" ? x.code.trim().toUpperCase() : "";
    return c === codeUpper;
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
      const code = normCode(request.body?.code);

      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      // (volitelná) rychlá pre-check pojistka:
      // najdeme kartu podle kódu a zkontrolujeme cooldown pres lastEventAt
      // Pozn.: i kdyby se to nepoužilo, redeemByCodeForMerchant má být autoritativní.
      const preCard = await Card.findOne(
        { merchantId, "redeemCodes.code": code },
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
      const res = await redeemByCodeForMerchant({
        Card,
        CardEvent,
        merchantId,
        code,
        source: "merchant_scan",
        actorId: merchantId,
      });

      if (!res?.ok) {
        return reply.code(res?.status || 400).send({ error: res?.error || "redeem failed" });
      }

      const updatedCard = res.card; // už po redeemu

      // nastav lastEventAt (pojistka pro cooldown i audit)
      // (pokud to už delá helper, nic to nezkazí)
      try {
        updatedCard.lastEventAt = new Date();
        await updatedCard.save();
      } catch {
        // ignore (helper už mohl uložit, nebo mužeš odstranit pokud vadí)
      }

      // 2) Updated public payload (vybere 1 aktivní redeem dle priority reward?coupon)
      const publicPayload = await buildPublicCardPayload(String(updatedCard._id));

      // 3) redeemedAt ideálne z uloženého redeemCodes záznamu (ne “now”)
      const redeemedAt =
        findRedeemedAtFromCard(updatedCard, code) || new Date().toISOString();

      return reply.send({
        ok: true,
        redeemed: {
          code: res.code || code,
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

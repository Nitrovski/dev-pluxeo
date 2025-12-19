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

      const codeCandidates = Array.from(
        new Set([code, codeAlt].filter(Boolean))
      );

      // pre-check cooldown
      const preCard = await Card.findOne(
        { merchantId, "redeemCodes.code": { $in: codeCandidates } },
        { lastEventAt: 1 }
      );

      if (preCard?.lastEventAt) {
        const diff = Date.now() - new Date(preCard.lastEventAt).getTime();
        if (diff < REDEEM_COOLDOWN_MS) {
          return reply.code(429).send({
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

      if (!res?.ok) {
        return reply
          .code(res?.status || 400)
          .send({ error: res?.error || "redeem failed" });
      }

      const updatedCard = res.card;

      const publicPayload = await buildPublicCardPayload(
        String(updatedCard._id)
      );

      const redeemedAt =
        findRedeemedAtFromCard(updatedCard, res.code || usedCode) ||
        new Date().toISOString();

      return reply.send({
        ok: true,

        redeemed: {
          code: res.code || usedCode,
          purpose: res.purpose,              // reward | coupon
          type: res.purpose,                 // alias pro FE
          redeemedAt,
          couponMeta: res.purpose === "coupon" ? res.meta ?? null : null,
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
      request.log.error({ err, stack: err?.stack }, "merchant scan failed");
  return reply.code(500).send({ error: err?.message || "scan failed" });
}
  });
}

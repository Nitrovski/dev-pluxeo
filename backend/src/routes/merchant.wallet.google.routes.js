import { getAuth } from "@clerk/fastify";
import { googleWalletConfig } from "../config/googleWallet.config.js";
import { Card } from "../models/card.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";
import {
  createAddToWalletLinkForCard,
  ensureGenericClassForMerchant,
  ensureLoyaltyClassForMerchant,
  ensureGooglePassForCard,
} from "../lib/googleWalletPass.js";
import {
  buildGoogleWalletErrorResponse,
  isGoogleWalletBadRequest,
  walletRequest,
} from "../lib/googleWalletClient.js";
import { makeClassId, makeObjectId } from "../lib/googleWalletIds.js";

function trySendGoogleWalletBadRequest(reply, err) {
  if (!isGoogleWalletBadRequest(err)) return false;

  const errorPayload = buildGoogleWalletErrorResponse(err);
  reply.code(400).send(errorPayload);

  return true;
}

export async function merchantWalletGoogleRoutes(fastify) {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      if (!body) return done(null, {});

      try {
        const json = JSON.parse(body);
        return done(null, json);
      } catch (err) {
        return done(err);
      }
    }
  );

  fastify.get("/api/merchant/wallet/google/debug", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      if (!googleWalletConfig.isDevEnv) {
        return reply.code(403).send({ error: "Not available in production" });
      }

      const merchantId = userId;
      const walletToken = String(request.query?.walletToken || "").trim();
      const cardId = String(request.query?.cardId || "").trim();

      if (!walletToken && !cardId) {
        return reply
          .code(400)
          .send({ error: "walletToken or cardId is required" });
      }

      const cardQuery = walletToken
        ? { merchantId, walletToken }
        : { merchantId, _id: cardId };

      const card = await Card.findOne(cardQuery);
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      const classId = makeClassId({
        issuerId: googleWalletConfig.issuerId,
        classPrefix: googleWalletConfig.classPrefix,
        merchantId,
      });

      const objectId =
        card.googleWallet?.objectId ||
        makeObjectId({ issuerId: googleWalletConfig.issuerId, cardId: card._id });

      const [classData, objectData] = await Promise.all([
        walletRequest({
          method: "GET",
          path: `/walletobjects/v1/loyaltyClass/${classId}`,
        }),
        walletRequest({
          method: "GET",
          path: `/walletobjects/v1/loyaltyObject/${objectId}`,
        }),
      ]);

      return reply.send({
        class: {
          id: classId,
          issuerName: classData?.issuerName ?? null,
          programName: classData?.programName ?? null,
          classTemplateInfo: classData?.classTemplateInfo ?? null,
        },
        object: {
          id: objectId,
          barcode: objectData?.barcode ?? null,
          textModulesData: objectData?.textModulesData ?? [],
          linksModuleData: objectData?.linksModuleData ?? null,
        },
      });
    } catch (err) {
      request.log?.error?.(err, "fetch wallet debug failed");
      const statusCode = err?.status || 500;
      const errorBody =
        err?.responseBody || err?.message || "Failed to fetch wallet debug info";
      return reply.code(statusCode).send({ error: errorBody });
    }
  });

  fastify.get("/api/merchant/wallet/google/debug/class", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      if (!googleWalletConfig.isDevEnv) {
        return reply.code(403).send({ error: "Not available in production" });
      }

      const merchantId = userId;
      const classId = makeClassId({
        issuerId: googleWalletConfig.issuerId,
        classPrefix: googleWalletConfig.classPrefix,
        merchantId,
      });

      const data = await walletRequest({
        method: "GET",
        path: `/walletobjects/v1/loyaltyClass/${classId}`,
      });

      return reply.send({
        class: {
          id: classId,
          classTemplateInfo: data?.classTemplateInfo ?? null,
          programLogoUrl: data?.programLogo?.sourceUri?.uri ?? null,
          heroImageUrl: data?.heroImage?.sourceUri?.uri ?? null,
          issuerName: data?.issuerName ?? null,
          programName: data?.programName ?? null,
        },
      });
    } catch (err) {
      request.log?.error?.(err, "fetch wallet class failed");
      const statusCode = err?.status || 500;
      const errorBody = err?.responseBody || err?.message || "Failed to fetch class";
      return reply.code(statusCode).send({ error: errorBody });
    }
  });

  fastify.get("/api/merchant/wallet/google/debug/object", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      if (!googleWalletConfig.isDevEnv) {
        return reply.code(403).send({ error: "Not available in production" });
      }

      const merchantId = userId;
      const cardId = String(request.query?.cardId || "").trim();

      if (!cardId) {
        return reply.code(400).send({ error: "cardId is required" });
      }

      const card = await Card.findOne({ merchantId, _id: cardId });
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      const classId = makeClassId({
        issuerId: googleWalletConfig.issuerId,
        classPrefix: googleWalletConfig.classPrefix,
        merchantId,
      });

      const objectId = makeObjectId({
        issuerId: googleWalletConfig.issuerId,
        cardId: card._id,
      });

      const data = await walletRequest({
        method: "GET",
        path: `/walletobjects/v1/loyaltyObject/${objectId}`,
      });

      return reply.send({
        object: {
          id: objectId,
          classId,
          barcode: data?.barcode ?? null,
          textModulesData: data?.textModulesData ?? [],
          linksModuleData: data?.linksModuleData ?? null,
        },
      });
    } catch (err) {
      request.log?.error?.(err, "fetch wallet object failed");
      const statusCode = err?.status || 500;
      const errorBody = err?.responseBody || err?.message || "Failed to fetch object";
      return reply.code(statusCode).send({ error: errorBody });
    }
  });

  fastify.post("/api/merchant/wallet/google/link", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const cardId = request.body?.cardId;

      if (!cardId) {
        return reply.code(400).send({ error: "cardId is required" });
      }

      const card = await Card.findOne({ _id: cardId, merchantId });
      if (!card) return reply.code(404).send({ error: "Card not found" });

      const template = await CardTemplate.findOne({ merchantId }).lean();
      const googleWalletEnabled = Boolean(template?.wallet?.google?.enabled);
      const requestedPassType = template?.wallet?.google?.passType || "loyalty";

      const { url, classId, objectId, passType } = await createAddToWalletLinkForCard(
        cardId,
        { templateOverride: template, logger: request.log }
      );

      request.log?.info?.(
        {
          merchantId,
          cardId: card._id,
          passType,
          requestedPassType,
          googleWalletEnabled,
          classId,
          objectId,
          hasUrl: Boolean(url),
        },
        "create add to wallet link success"
      );

      return reply.send({ url, classId, objectId, passType });
    } catch (err) {
      request.log?.error?.(
        { err, responseBody: err?.responseBody, stack: err?.stack },
        "create add to wallet link failed"
      );
      if (trySendGoogleWalletBadRequest(reply, err)) return;

      return reply.code(500).send({ error: err?.message || "Failed to create link" });
    }
  });

  fastify.post("/api/merchant/wallet/google/sync-class", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (googleWalletConfig.isDevEnv && request.log?.info) {
        const authHeaderPresent = Boolean(request.headers?.authorization);
        request.log.info(
          { authHeaderPresent, isAuthenticated },
          "DEV wallet class sync auth debug"
        );
      }

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const template = await CardTemplate.findOne({ merchantId }).lean();

      const isGenericEnabled =
        template?.wallet?.google?.passType === "generic" &&
        template?.wallet?.google?.genericConfig?.enabled === true;
      const resolvedPassType = isGenericEnabled ? "generic" : "loyalty";

      const ensureFn =
        resolvedPassType === "generic"
          ? ensureGenericClassForMerchant
          : ensureLoyaltyClassForMerchant;

      const { classId } = await ensureFn({
        merchantId,
        forcePatch: true,
        template,
      });

      console.log("GW_SYNC", {
        kind: "class",
        passType: resolvedPassType,
        merchantId,
        cardId: null,
      });

      if (googleWalletConfig.isDevEnv && request.log && request.log.info) {
        request.log.info(
          { merchantId, classId, passType: resolvedPassType },
          "DEV wallet class sync requested"
        );
      }

      return reply.send({ ok: true, passType: resolvedPassType, classId, synced: true });
    } catch (err) {
      request.log?.error?.(err, "sync wallet class failed");
      if (trySendGoogleWalletBadRequest(reply, err)) return;

      return reply.code(500).send({ error: err?.message || "Failed to sync class" });
    }
  });

  fastify.post("/api/merchant/wallet/google/sync-object", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const cardId = String(request.body?.cardId || "").trim();

      if (!cardId) {
        return reply.code(400).send({ error: "cardId is required" });
      }

      const card = await Card.findOne({ merchantId, _id: cardId });
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      const { objectId, classId, passType } = await ensureGooglePassForCard({
        merchantId,
        cardId: card._id,
        forcePatch: true,
      });

      console.log("GW_SYNC", {
        kind: "object",
        passType,
        merchantId,
        cardId: card._id,
      });

      if (googleWalletConfig.isDevEnv && request.log && request.log.info) {
        request.log.info(
          { merchantId, cardId: card._id, objectId, classId, passType },
          "DEV wallet object sync requested"
        );
      }

      return reply.send({ ok: true, passTypeUsed: passType, objectId });
    } catch (err) {
      request.log?.error?.(err, "sync wallet object failed");
      if (trySendGoogleWalletBadRequest(reply, err)) return;

      return reply.code(500).send({ error: err?.message || "Failed to sync object" });
    }
  });
}

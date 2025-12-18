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
// 1 stamp / 1 min
const STAMP_COOLDOWN_MS = 60_000;

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

  const n = candidates.find((x) => typeof x === "number" && x > 0);
  return typeof n === "number" && n > 0 ? n : 10; // fallback 10
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

      // 1) najdi kartu podle merchantId + walletTokenu (eliminuje mismatch a je to bezpecnejší)
      const card = await Card.findOne({ merchantId, walletToken: token });
      if (!card) return reply.code(404).send({ error: "card not found" });

      // 2) anti double-scan guard (server-side pojistka)
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

      // 3) zjisti threshold z Customer

import test from "node:test";
import assert from "node:assert";
import {
  buildCardEventPayload,
  buildScanEventPayload,
  CARD_EVENT_TYPES,
} from "../src/lib/eventSchemas.js";

test("buildCardEventPayload applies defaults and validation", () => {
  const payload = buildCardEventPayload({
    merchantId: "m1",
    cardId: "card1",
    type: CARD_EVENT_TYPES[1],
    payload: { value: 1 },
  });

  assert.strictEqual(payload.merchantId, "m1");
  assert.strictEqual(payload.cardId, "card1");
  assert.strictEqual(payload.type, "STAMP_ADDED");
  assert.strictEqual(payload.deltaStamps, 0);
  assert.strictEqual(payload.deltaRewards, 0);
  assert.deepStrictEqual(payload.actor, {
    type: "merchant",
    actorId: null,
    source: "merchant-app",
  });
  assert.deepStrictEqual(payload.payload, { value: 1 });
});

test("buildCardEventPayload rejects missing required fields", () => {
  assert.throws(
    () => buildCardEventPayload({ merchantId: "m1", cardId: "card1" }),
    /type is required/
  );
});

test("buildScanEventPayload enforces status and defaults", () => {
  const payload = buildScanEventPayload({ status: "success", payload: { ok: true } });
  assert.strictEqual(payload.status, "success");
  assert.strictEqual(payload.reason, null);
  assert.deepStrictEqual(payload.payload, { ok: true });

  assert.throws(() => buildScanEventPayload({ status: "oops" }), /status is required/);
});

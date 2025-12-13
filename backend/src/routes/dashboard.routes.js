import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default async function dashboardRoutes(fastify) {
  fastify.get("/api/dashboard", async (request, reply) => {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }

    const merchantId = userId;

    const now = new Date();
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);
    const d7 = addDays(today, -6);   // včetně dneška
    const d30 = addDays(today, -29); // včetně dneška

    // 14 dní (včetně dneška)
    const seriesFrom = startOfDay(addDays(today, -13));
    const seriesTo = tomorrow;

    /* -------------------------------------------------
     * KPI – stavové (Card) + nové karty (Card)
     * ------------------------------------------------- */
    const [activeCards, newCards7d, newCards30d, cardSums] = await Promise.all([
      Card.countDocuments({ merchantId }),
      Card.countDocuments({ merchantId, createdAt: { $gte: d7, $lt: tomorrow } }),
      Card.countDocuments({ merchantId, createdAt: { $gte: d30, $lt: tomorrow } }),
      Card.aggregate([
        { $match: { merchantId } },
        {
          $group: {
            _id: null,
            totalStamps: { $sum: "$stamps" },
            totalRewards: { $sum: "$rewards" },
          },
        },
      ]),
    ]);

    const totalStamps = cardSums?.[0]?.totalStamps ?? 0;
    const totalRewards = cardSums?.[0]?.totalRewards ?? 0;

    /* -------------------------------------------------
     * KPI – event-based (CardEvent)
     * ------------------------------------------------- */
    const [stampsToday, stamps7d, rewardsToday, rewards7d] = await Promise.all([
      CardEvent.countDocuments({
        merchantId,
        type: "STAMP_ADDED",
        createdAt: { $gte: today, $lt: tomorrow },
      }),
      CardEvent.countDocuments({
        merchantId,
        type: "STAMP_ADDED",
        createdAt: { $gte: d7, $lt: tomorrow },
      }),
      CardEvent.countDocuments({
        merchantId,
        type: "REWARD_REDEEMED",
        createdAt: { $gte: today, $lt: tomorrow },
      }),
      CardEvent.countDocuments({
        merchantId,
        type: "REWARD_REDEEMED",
        createdAt: { $gte: d7, $lt: tomorrow },
      }),
    ]);

    /* -------------------------------------------------
     * Series – denní grafy z eventů (14 dní)
     * ------------------------------------------------- */
    const dailyEventsAgg = await CardEvent.aggregate([
      {
        $match: {
          merchantId,
          createdAt: { $gte: seriesFrom, $lt: seriesTo },
          type: { $in: ["STAMP_ADDED", "REWARD_REDEEMED"] },
        },
      },
      {
        $group: {
          _id: {
            type: "$type",
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
            d: { $dayOfMonth: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
    ]);

    const stampMap = new Map();
    const rewardMap = new Map();

    for (const row of dailyEventsAgg) {
      const key = `${row._id.y}-${String(row._id.m).padStart(2, "0")}-${String(row._id.d).padStart(2, "0")}`;
      if (row._id.type === "STAMP_ADDED") stampMap.set(key, row.count);
      if (row._id.type === "REWARD_REDEEMED") rewardMap.set(key, row.count);
    }

    const stampsDaily = [];
    const rewardsDaily = [];

    for (let i = 0; i < 14; i++) {
      const day = startOfDay(addDays(seriesFrom, i));
      const key = dayKey(day);
      stampsDaily.push({ day: key, count: stampMap.get(key) ?? 0 });
      rewardsDaily.push({ day: key, count: rewardMap.get(key) ?? 0 });
    }

    /* -------------------------------------------------
     * Series – nové karty po dnech (14 dní) – z Card.createdAt
     * ------------------------------------------------- */
    const dailyCardsAgg = await Card.aggregate([
      { $match: { merchantId, createdAt: { $gte: seriesFrom, $lt: seriesTo } } },
      {
        $group: {
          _id: {
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
            d: { $dayOfMonth: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
    ]);

    const newCardMap = new Map();
    for (const row of dailyCardsAgg) {
      const key = `${row._id.y}-${String(row._id.m).padStart(2, "0")}-${String(row._id.d).padStart(2, "0")}`;
      newCardMap.set(key, row.count);
    }

    const newCardsDaily = [];
    for (let i = 0; i < 14; i++) {
      const day = startOfDay(addDays(seriesFrom, i));
      const key = dayKey(day);
      newCardsDaily.push({ day: key, count: newCardMap.get(key) ?? 0 });
    }

    /* -------------------------------------------------
     * Aktivita – poslední eventy
     * ------------------------------------------------- */
    const lastEvents = await CardEvent.find({ merchantId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const activity = lastEvents.map((e) => ({
      type:
        e.type === "STAMP_ADDED"
          ? "stamp"
          : e.type === "REWARD_REDEEMED"
          ? "reward"
          : e.type === "CARD_CREATED"
          ? "card_created"
          : "note",
      title:
        e.type === "STAMP_ADDED"
          ? "Přidáno razítko"
          : e.type === "REWARD_REDEEMED"
          ? "Uplatněna odměna"
          : e.type === "CARD_CREATED"
          ? "Nová karta vytvořena"
          : "Aktualizace karty",
      meta: `karta ${String(e.walletToken || "").slice(0, 6)}…`,
      ts: e.createdAt.toISOString(),
    }));

    return reply.send({
      kpis: {
        // Card state
        activeCards,
        newCards7d,
        newCards30d,
        totalStamps,
        totalRewards,

        // Event-based
        stampsToday,
        stamps7d,
        rewardsToday,
        rewards7d,
      },
      series: {
        // Event-based
        stampsDaily,
        rewardsDaily,

        // Card-based
        newCardsDaily,
      },
      activity,
    });
  });
}

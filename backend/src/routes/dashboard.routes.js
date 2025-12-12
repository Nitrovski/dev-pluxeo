import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";

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

export default async function dashboardRoutes(fastify) {
  fastify.get("/api/dashboard", async (request, reply) => {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }

    const merchantId = userId;

    const now = new Date();
    const d7 = addDays(now, -7);
    const d30 = addDays(now, -30);

    const [activeCards, newCards7d, newCards30d, sums] = await Promise.all([
      Card.countDocuments({ merchantId }),
      Card.countDocuments({ merchantId, createdAt: { $gte: d7 } }),
      Card.countDocuments({ merchantId, createdAt: { $gte: d30 } }),
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

    const totalStamps = sums?.[0]?.totalStamps ?? 0;
    const totalRewards = sums?.[0]?.totalRewards ?? 0;

    // series: nové karty po dnech za posledních 14 dní
    const from = startOfDay(addDays(now, -13));
    const to = addDays(startOfDay(now), 1);

    const dailyAgg = await Card.aggregate([
      { $match: { merchantId, createdAt: { $gte: from, $lt: to } } },
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

    const map = new Map();
    for (const row of dailyAgg) {
      const y = row._id.y;
      const m = String(row._id.m).padStart(2, "0");
      const d = String(row._id.d).padStart(2, "0");
      map.set(`${y}-${m}-${d}`, row.count);
    }

    const newCardsDaily = [];
    for (let i = 0; i < 14; i++) {
      const day = startOfDay(addDays(from, i));
      const y = day.getFullYear();
      const m = String(day.getMonth() + 1).padStart(2, "0");
      const d = String(day.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${d}`;
      newCardsDaily.push({ day: key, count: map.get(key) ?? 0 });
    }

    // “aktivita” v1: poslední vytvořené karty
    const lastCards = await Card.find({ merchantId })
      .sort({ createdAt: -1 })
      .limit(6)
      .select({ walletToken: 1, createdAt: 1 })
      .lean();

    const activity = lastCards.map((c) => ({
      type: "card_created",
      title: "Nová karta vytvořena",
      meta: `walletToken: ${String(c.walletToken).slice(0, 6)}…`,
      ts: new Date(c.createdAt).toISOString(),
    }));

    return reply.send({
      kpis: { activeCards, newCards7d, newCards30d, totalStamps, totalRewards },
      series: { newCardsDaily },
      activity,
    });
  });
}

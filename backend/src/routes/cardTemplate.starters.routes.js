// src/routes/cardTemplate.starters.routes.js

const PROVIDER_GOOGLE = "google";
const PASS_TYPE_GENERIC = "generic";

const DEFAULT_BACKGROUND_COLOR = "#FF9900";

const buildTextModulesData = (rows) => {
  const modules = [];

  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;

    if (row.type === "one") {
      if (row.value) {
        modules.push({
          header: row.value.label || "",
          body: row.value.value || "",
        });
      }
      return;
    }

    if (row.left) {
      modules.push({
        header: row.left.label || "",
        body: row.left.value || "",
      });
    }

    if (row.right) {
      modules.push({
        header: row.right.label || "",
        body: row.right.value || "",
      });
    }
  });

  return modules;
};

const buildGenericLayout = (rows) => {
  const layoutRows = rows.map((row) => {
    if (!row || typeof row !== "object") {
      return { type: "two", left: null, right: null };
    }

    if (row.type === "one") {
      return {
        type: "one",
        value: row.value
          ? {
              fieldId: row.value.fieldId || null,
              label: row.value.label || null,
            }
          : null,
      };
    }

    return {
      type: "two",
      left: row.left
        ? {
            fieldId: row.left.fieldId || null,
            label: row.left.label || null,
          }
        : null,
      right: row.right
        ? {
            fieldId: row.right.fieldId || null,
            label: row.right.label || null,
          }
        : null,
    };
  });

  while (layoutRows.length < 3) {
    if (layoutRows.length < 2) {
      layoutRows.push({ type: "two", left: null, right: null });
    } else {
      layoutRows.push({ type: "one", value: null });
    }
  }

  return { cardRows: layoutRows.slice(0, 3) };
};

const buildGenericPreset = ({ programType, qrEnabled, rows }) => {
  const textModulesData = buildTextModulesData(rows);

  return {
    programType,
    wallet: {
      google: {
        enabled: true,
        passType: PASS_TYPE_GENERIC,
        backgroundColor: DEFAULT_BACKGROUND_COLOR,
        genericConfig: {
          enabled: true,
          qr: { enabled: qrEnabled },
          barcode: { enabled: qrEnabled, type: "QR_CODE" },
          showStampsModule: true,
          showPromo: true,
          showWebsite: false,
          showOpeningHours: false,
          showEmail: false,
          showTier: false,
          rows,
          layout: buildGenericLayout(rows),
        },
        textModulesData,
      },
      apple: {},
    },
  };
};

const GENERIC_STARTERS = [
  {
    id: "generic_loyalty_stamps",
    title: "Loyalty: Stamps + Rewards + QR",
    description: "Track stamps and rewards with a QR-based redemption flow.",
    tags: ["Generic", "Loyalty", "Stamps", "Rewards", "QR"],
    preset: buildGenericPreset({
      programType: "stamps",
      qrEnabled: true,
      rows: [
        {
          type: "two",
          left: {
            fieldId: "stamps",
            label: "Stamps",
            value: "{stamps}",
          },
          right: {
            fieldId: "rewards",
            label: "Rewards",
            value: "{rewards}",
          },
        },
        {
          type: "two",
          left: {
            fieldId: "promoText",
            label: "Next reward",
            value: "{reward_hint}",
          },
          right: null,
        },
        {
          type: "one",
          value: {
            fieldId: "websiteUrl",
            label: "Website",
            value: "{website}",
          },
        },
      ],
    }),
  },
  {
    id: "generic_info_card",
    title: "Info card: 3 rows, no QR",
    description: "Simple info layout for contact details and opening hours.",
    tags: ["Generic", "Info", "No QR"],
    preset: buildGenericPreset({
      programType: "info",
      qrEnabled: false,
      rows: [
        {
          type: "two",
          left: {
            fieldId: "customMessage",
            label: "Phone",
            value: "{phone}",
          },
          right: {
            fieldId: "openingHours",
            label: "Hours",
            value: "{hours}",
          },
        },
        {
          type: "two",
          left: {
            fieldId: "promoText",
            label: "Address",
            value: "{address}",
          },
          right: null,
        },
        {
          type: "one",
          value: {
            fieldId: "websiteUrl",
            label: "Website",
            value: "{website}",
          },
        },
      ],
    }),
  },
  {
    id: "generic_promo_coupon",
    title: "Promo/Coupon: 2 rows + QR",
    description: "Coupon-style card with promo headline and QR redemption.",
    tags: ["Generic", "Promo", "Coupon", "QR"],
    preset: buildGenericPreset({
      programType: "coupon",
      qrEnabled: true,
      rows: [
        {
          type: "two",
          left: {
            fieldId: "promoText",
            label: "Offer",
            value: "{offer}",
          },
          right: {
            fieldId: "openingHours",
            label: "Valid until",
            value: "{expires}",
          },
        },
        {
          type: "two",
          left: {
            fieldId: "customMessage",
            label: "Redeem at",
            value: "{location}",
          },
          right: null,
        },
        {
          type: "one",
          value: {
            fieldId: "websiteUrl",
            label: "Website",
            value: "{website}",
          },
        },
      ],
    }),
  },
  {
    id: "generic_membership",
    title: "Membership card: 2-3 rows",
    description: "Membership card with member ID and tier, QR optional.",
    tags: ["Generic", "Membership", "ID"],
    preset: buildGenericPreset({
      programType: "info",
      qrEnabled: false,
      rows: [
        {
          type: "two",
          left: {
            fieldId: "customMessage",
            label: "Member ID",
            value: "{member_id}",
          },
          right: {
            fieldId: "promoText",
            label: "Tier",
            value: "{tier}",
          },
        },
        {
          type: "two",
          left: {
            fieldId: "openingHours",
            label: "Member since",
            value: "{member_since}",
          },
          right: null,
        },
        {
          type: "one",
          value: {
            fieldId: "websiteUrl",
            label: "Website",
            value: "{website}",
          },
        },
      ],
    }),
  },
];

const STARTERS_BY_PROVIDER = new Map([
  [
    PROVIDER_GOOGLE,
    new Map([
      [PASS_TYPE_GENERIC, GENERIC_STARTERS],
    ]),
  ],
]);

const getStarters = ({ provider, passType }) => {
  const providerKey = provider?.toLowerCase?.() || PROVIDER_GOOGLE;
  const passTypeKey = passType?.toLowerCase?.() || PASS_TYPE_GENERIC;

  const providerMap = STARTERS_BY_PROVIDER.get(providerKey);
  if (!providerMap) return [];

  return providerMap.get(passTypeKey) || [];
};

export async function cardTemplateStarterRoutes(fastify) {
  // Self-test:
  // curl "http://localhost:3000/api/card-template/starters?provider=google&passType=generic"
  fastify.get("/api/card-template/starters", async (request, reply) => {
    const { provider, passType } = request.query || {};
    const starters = getStarters({ provider, passType });

    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");

    return reply.send({ ok: true, starters });
  });
}

export const DEFAULT_CARD_CONTENT = {
  headline: "",
  subheadline: "",
  openingHours: "",
  customMessage: "",
  websiteUrl: "",

  themeVariant: "classic",      // "classic" | "stamps" | "minimal"
  primaryColor: "#FF9900",
  secondaryColor: "#111111",

  freeStampsToReward: 0,        // number
};

export function normalizeCardContent(input = {}) {
  const out = { ...DEFAULT_CARD_CONTENT, ...(input || {}) };

  // freeStampsToReward -> number (ne NaN)
  const n = Number(out.freeStampsToReward);
  out.freeStampsToReward = Number.isFinite(n) ? n : DEFAULT_CARD_CONTENT.freeStampsToReward;

  // themeVariant -> enum fallback
  const allowed = new Set(["classic", "stamps", "minimal"]);
  if (!allowed.has(out.themeVariant)) {
    out.themeVariant = DEFAULT_CARD_CONTENT.themeVariant;
  }

  // barvy -> string fallback
  out.primaryColor = typeof out.primaryColor === "string" ? out.primaryColor : DEFAULT_CARD_CONTENT.primaryColor;
  out.secondaryColor = typeof out.secondaryColor === "string" ? out.secondaryColor : DEFAULT_CARD_CONTENT.secondaryColor;

  // texty -> string fallback
  for (const k of ["headline", "subheadline", "openingHours", "customMessage", "websiteUrl"]) {
    out[k] = typeof out[k] === "string" ? out[k] : "";
  }

  return out;
}

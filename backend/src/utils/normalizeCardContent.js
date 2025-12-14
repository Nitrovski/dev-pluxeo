export const DEFAULT_CARD_CONTENT = {
  headline: "",
  subheadline: "",
  openingHours: "",
  customMessage: "",
  websiteUrl: "",

  themeVariant: "classic",
  primaryColor: "#FF9900",
  secondaryColor: "#111111",
};

export function normalizeCardContent(input = {}) {
  const out = { ...DEFAULT_CARD_CONTENT, ...(input || {}) };

  // themeVariant -> enum fallback
  const allowed = new Set(["classic", "stamps", "minimal"]);
  if (!allowed.has(out.themeVariant)) {
    out.themeVariant = DEFAULT_CARD_CONTENT.themeVariant;
  }

  // barvy -> string fallback
  out.primaryColor =
    typeof out.primaryColor === "string"
      ? out.primaryColor
      : DEFAULT_CARD_CONTENT.primaryColor;

  out.secondaryColor =
    typeof out.secondaryColor === "string"
      ? out.secondaryColor
      : DEFAULT_CARD_CONTENT.secondaryColor;

  // texty -> string fallback
  for (const k of ["headline", "subheadline", "openingHours", "customMessage", "websiteUrl"]) {
    out[k] = typeof out[k] === "string" ? out[k] : "";
  }

  return out;
}

const ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+5F3cAAAAASUVORK5CYII=";
const LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AAAgMBgI2b9QAAAABJRU5ErkJggg==";

// TODO: In the future we may download template.logoUrl and package it as logo.png,
// but MVP uses embedded defaults.
export async function loadDefaultAppleAssets() {
  return {
    "icon.png": Buffer.from(ICON_PNG_BASE64, "base64"),
    "logo.png": Buffer.from(LOGO_PNG_BASE64, "base64"),
  };
}

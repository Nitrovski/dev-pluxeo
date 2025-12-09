// src/apiClient.js

// Musí bıt nastavena na Vercelu jako VITE_API_BASE_URL = https://tvuj-backend.onrender.com
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!API_BASE_URL) {
  console.error("? Chybí VITE_API_BASE_URL – nastav ho ve Vercel Environment Variables.");
}

/**
 * Obecnı wrapper na fetch, kterı:
 *  - pridá API key do hlavicek
 *  - zpracuje JSON response
 */
export async function apiRequest(
  path,
  { method = "GET", apiKey, body } = {}
) {
  if (!apiKey) {
    throw new Error("API key není nastavenı.");
  }

  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL není nastavenı ve Vercelu.");
  }

  const url = `${API_BASE_URL}${path}`;

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey, // tvoje API key hlavicka
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Server vrátil chybu ${res.status}`;

    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

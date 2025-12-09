// src/apiClient.js

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

/**
 * Obecnı wrapper na fetch, kterı:
 *  - pridá API key do hlavicek
 *  - zpracuje JSON response
 */
export async function apiRequest(path, { method = "GET", apiKey, body } = {}) {
  if (!apiKey) {
    throw new Error("API key není nastavenı.");
  }

  const url = `${API_BASE_URL}${path}`;

  const headers = {
    "Content-Type": "application/json",
    // pokud máš v backendu jinou hlavicku, tady to prejmenuj:
    "x-api-key": apiKey,
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
      (data && data.message) ||
      data?.error ||
      `Request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

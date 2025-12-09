// src/components/CardContentEditor.jsx
import React, { useState } from "react";
import { useApiKey } from "../context/ApiKeyContext";
import { apiRequest } from "../apiClient";

export default function CardContentEditor() {
  const { apiKey } = useApiKey();
  const [customerId, setCustomerId] = useState("");
  const [cardContent, setCardContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResultMessage("");
    if (!apiKey) {
      setResultMessage("? Nejprve nastav API key.");
      return;
    }
    if (!customerId.trim()) {
      setResultMessage("? Zadej ID zákazníka (customerId).");
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiRequest(
        `/api/customers/${encodeURIComponent(
          customerId.trim()
        )}/card-content`,
        {
          method: "PATCH",
          apiKey,
          body: {
            cardContent,
          },
        }
      );

      setResultMessage(
        `? Uloženo. Server odpovedel: ${
          typeof data === "object" ? JSON.stringify(data) : String(data)
        }`
      );
    } catch (err) {
      console.error(err);
      setResultMessage(
        `? Chyba: ${err.message || "Nepodarilo se uložit cardContent."}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        marginTop: "2rem",
        padding: "1rem",
        borderRadius: "0.5rem",
        border: "1px solid #e5e7eb",
        maxWidth: "600px",
      }}
    >
      <h2 style={{ marginBottom: "0.75rem" }}>Editace cardContent</h2>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label>
          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
            Customer ID
          </span>
          <input
            type="text"
            placeholder="napr. 6750481..."
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.375rem",
              border: "1px solid #ccc",
            }}
          />
        </label>

        <label>
          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
            cardContent (text / JSON)
          </span>
          <textarea
            rows={6}
            placeholder='Napr. {"stamps":3,"tier":"silver"}'
            value={cardContent}
            onChange={(e) => setCardContent(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.375rem",
              border: "1px solid #ccc",
              fontFamily: "monospace",
              fontSize: "0.9rem",
            }}
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          style={{
            alignSelf: "flex-start",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            border: "none",
            background: "#2563eb",
            color: "white",
            cursor: "pointer",
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          {isLoading ? "Ukládám..." : "Uložit cardContent"}
        </button>
      </form>

      {resultMessage && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
          {resultMessage}
        </p>
      )}
    </div>
  );
}

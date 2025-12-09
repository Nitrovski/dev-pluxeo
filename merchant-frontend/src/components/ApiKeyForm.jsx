// src/components/ApiKeyForm.jsx
import React, { useState } from "react";
import { useApiKey } from "../context/ApiKeyContext";

export default function ApiKeyForm() {
  const { apiKey, setApiKey } = useApiKey();
  const [value, setValue] = useState(apiKey || "");

  const handleSubmit = (e) => {
    e.preventDefault();
    setApiKey(value.trim());
  };

  const handleClear = () => {
    setValue("");
    setApiKey("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: "400px",
      }}
    >
      <label>
        <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
          Merchant API key
        </span>
        <input
          type="password"
          placeholder="Zadej API key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid #ccc",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="submit"
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            border: "none",
            background: "#111827",
            color: "white",
            cursor: "pointer",
          }}
        >
          Uložit API key
        </button>
        {apiKey && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.375rem",
              border: "1px solid #ccc",
              background: "white",
              cursor: "pointer",
            }}
          >
            Odhlásit / smazat key
          </button>
        )}
      </div>
      {apiKey && (
        <p style={{ fontSize: "0.8rem", color: "green" }}>
          ? API key je uložený (localStorage).
        </p>
      )}
    </form>
  );
}

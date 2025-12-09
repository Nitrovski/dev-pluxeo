// src/App.jsx
import React from "react";
import ApiKeyForm from "./components/ApiKeyForm";
import CardContentEditor from "./components/CardContentEditor";

export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          background: "white",
          borderRadius: "0.75rem",
          padding: "2rem",
          boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
        }}
      >
        <header style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ marginBottom: "0.25rem" }}>Pluxeo Merchant Console</h1>
          <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
            Jednoduché UI pro práci s kartami zákazníku (cardContent).
          </p>
        </header>

        <section>
          <h2 style={{ marginBottom: "0.5rem", fontSize: "1.1rem" }}>
            1. Prihlášení pomocí API key
          </h2>
          <ApiKeyForm />
        </section>

        <section>
          <CardContentEditor />
        </section>
      </div>
    </div>
  );
}

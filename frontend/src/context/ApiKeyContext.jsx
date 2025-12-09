// src/context/ApiKeyContext.jsx
import React, { createContext, useContext, useEffect, useState } from "react";

const ApiKeyContext = createContext(null);

export function ApiKeyProvider({ children }) {
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("merchant_api_key");
    if (stored) {
      setApiKey(stored);
    }
  }, []);

  const saveApiKey = (key) => {
    setApiKey(key);
    if (key) {
      window.localStorage.setItem("merchant_api_key", key);
    } else {
      window.localStorage.removeItem("merchant_api_key");
    }
  };

  return (
    <ApiKeyContext.Provider value={{ apiKey, setApiKey: saveApiKey }}>
      {children}
    </ApiKeyContext.Provider>
  );
}

export function useApiKey() {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) {
    throw new Error("useApiKey must be used within ApiKeyProvider");
  }
  return ctx;
}

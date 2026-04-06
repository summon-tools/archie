"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "@/lib/models";
import { fetcher } from "@/lib/swr";

const STORAGE_KEY = "archie-model-selection";
const LEGACY_KEY = "claudia-model";

interface ModelSelection {
  provider: string;
  model: string;
}

function loadSelection(): ModelSelection {
  if (typeof window === "undefined") {
    return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL_ID };
  }
  // Try new key first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  // Migrate from legacy key
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const selection = { provider: "claude", model: legacy };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    localStorage.removeItem(LEGACY_KEY);
    return selection;
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL_ID };
}

export function useSelectedModel() {
  const hasLocalOverride = typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEY);

  const { data: config } = useSWR<{ defaultModel: string; defaultProvider: string }>(
    hasLocalOverride ? null : "/api/models/config",
    fetcher,
  );

  const [selection, setSelection] = useState<ModelSelection>(loadSelection);

  // Use server default if no local override
  const effectiveProvider = hasLocalOverride
    ? selection.provider
    : (config?.defaultProvider || selection.provider);
  const effectiveModel = hasLocalOverride
    ? selection.model
    : (config?.defaultModel || selection.model);

  const handleModelChange = useCallback((provider: string, model: string) => {
    const next = { provider, model };
    setSelection(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  return {
    selectedModel: effectiveModel,
    selectedProvider: effectiveProvider,
    handleModelChange,
  };
}

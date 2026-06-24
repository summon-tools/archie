"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "@/lib/models";
import { fetcher } from "@/lib/swr";

const STORAGE_KEY = "archie-model-selection";
const LEGACY_KEY = "claudia-model";

interface ModelSelection {
  provider: string;
  model: string;
}

const DEFAULT_SELECTION: ModelSelection = { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL_ID };

function loadStoredSelection(): { hasLocalOverride: boolean; selection: ModelSelection } {
  if (typeof window === "undefined") {
    return { hasLocalOverride: false, selection: DEFAULT_SELECTION };
  }
  // Try new key first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<ModelSelection>;
      if (parsed.provider && parsed.model) {
        return { hasLocalOverride: true, selection: { provider: parsed.provider, model: parsed.model } };
      }
    } catch {}
  }
  // Migrate from legacy key
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    const selection = { provider: "claude", model: legacy };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    localStorage.removeItem(LEGACY_KEY);
    return { hasLocalOverride: true, selection };
  }
  return { hasLocalOverride: false, selection: DEFAULT_SELECTION };
}

export function useSelectedModel() {
  const [selection, setSelection] = useState<ModelSelection>(DEFAULT_SELECTION);
  const [hasLocalOverride, setHasLocalOverride] = useState(false);

  const { data: config } = useSWR<{ defaultModel: string; defaultProvider: string }>(
    hasLocalOverride ? null : "/api/models/config",
    fetcher,
  );

  useEffect(() => {
    const stored = loadStoredSelection();
    setSelection(stored.selection);
    setHasLocalOverride(stored.hasLocalOverride);
  }, []);

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
    setHasLocalOverride(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  return {
    selectedModel: effectiveModel,
    selectedProvider: effectiveProvider,
    handleModelChange,
  };
}

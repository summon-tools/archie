"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";

export interface ModelPickerOption {
  id: string;
  label: string;
  provider: string;
}

interface ModelPickerProps {
  model: string;
  provider?: string | null;
  availableModels: ModelPickerOption[];
  onChange: (provider: string, model: string) => void;
  variant?: "compact" | "field";
  placement?: "above-right" | "below-left" | "below-right";
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onAfterChange?: () => void;
}

export function getModelProviderLabel(providerKey: string) {
  if (providerKey === "claude") return "Claude Code";
  if (providerKey === "codex") return "Codex";
  return providerKey;
}

export default function ModelPicker({
  model,
  provider,
  availableModels,
  onChange,
  variant = "compact",
  placement = "above-right",
  className = "",
  disabled = false,
  ariaLabel = "Model",
  onAfterChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const groupedModels = useMemo(() => (
    availableModels.reduce<Record<string, ModelPickerOption[]>>((acc, candidate) => {
      (acc[candidate.provider] ??= []).push(candidate);
      return acc;
    }, {})
  ), [availableModels]);

  const selectedModel = useMemo(() => {
    const modelProvider = provider || availableModels.find((candidate) => candidate.id === model)?.provider;
    return availableModels.find((candidate) => (
      candidate.id === model && (!modelProvider || candidate.provider === modelProvider)
    )) || null;
  }, [availableModels, model, provider]);

  const activeProvider = provider || selectedModel?.provider || "claude";
  const isField = variant === "field";
  const buttonClassName = isField
    ? "flex w-full items-center justify-between gap-2 rounded-lg border border-th bg-th-subtle px-3 py-2 text-left text-sm text-th-primary transition-colors hover:bg-th-muted focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent disabled:opacity-60"
    : "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-th-muted hover:bg-th-subtle hover:text-th-primary focus:outline-none focus:ring-2 focus:ring-th transition-colors disabled:opacity-60";
  const labelClassName = isField ? "truncate" : "max-w-[120px] truncate";
  const optionClassName = isField ? "px-3 py-2.5 text-sm" : "px-3 py-2 text-xs";

  const updateMenuPosition = useCallback(() => {
    const anchor = buttonRef.current;
    if (!anchor || typeof window === "undefined") return;

    const rect = anchor.getBoundingClientRect();
    const gap = placement === "above-right" ? 8 : 4;
    const width = isField ? Math.max(rect.width, 224) : 176;
    const rawLeft = placement === "below-left" ? rect.left : rect.right - width;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));
    const availableHeight = placement === "above-right"
      ? Math.max(160, rect.top - 16)
      : Math.max(160, window.innerHeight - rect.bottom - 16);

    setMenuStyle({
      left,
      maxHeight: Math.min(360, availableHeight),
      position: "fixed",
      top: placement === "above-right" ? rect.top - gap : rect.bottom + gap,
      transform: placement === "above-right" ? "translateY(-100%)" : undefined,
      width,
      zIndex: 1000,
    });
  }, [isField, placement]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        (pickerRef.current && pickerRef.current.contains(target)) ||
        (menuRef.current && menuRef.current.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="overflow-auto rounded-xl border border-th bg-th-elevated shadow-xl"
      role="listbox"
      aria-label={ariaLabel}
      style={menuStyle || { position: "fixed", visibility: "hidden", zIndex: 1000 }}
    >
      {Object.entries(groupedModels).map(([providerKey, models]) => (
        <div key={providerKey}>
          <div className="px-3 py-1.5 text-meta font-semibold uppercase tracking-wider text-th-dimmed bg-th-subtle">
            {getModelProviderLabel(providerKey)}
          </div>
          {models.map((candidate) => {
            const isSelected = activeProvider === providerKey && model === candidate.id;
            return (
              <button
                key={`${providerKey}:${candidate.id}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setOpen(false);
                  onChange(providerKey, candidate.id);
                  onAfterChange?.();
                }}
                className={`w-full text-left transition-colors ${optionClassName} ${
                  isSelected
                    ? "bg-st-blue text-th-primary"
                    : "text-th-secondary hover:bg-th-muted hover:text-th-primary"
                }`}
              >
                {candidate.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`} ref={pickerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          updateMenuPosition();
          setOpen((current) => !current);
        }}
        className={buttonClassName}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled || availableModels.length === 0}
      >
        <span className={labelClassName}>{selectedModel?.label || model}</span>
        <CaretDown size={isField ? 12 : 10} className="shrink-0 text-th-muted" />
      </button>

      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

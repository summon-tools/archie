"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { EFFORT_OPTIONS, type EffortLevel } from "@/lib/effort";

interface EffortPickerProps {
  effort: EffortLevel;
  onChange: (effort: EffortLevel) => void;
  disabled?: boolean;
}

export default function EffortPicker({ effort, onChange, disabled = false }: EffortPickerProps) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedOption = EFFORT_OPTIONS.find((option) => option.id === effort);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Effort"
        title="Effort"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-th-muted transition-colors hover:bg-th-subtle hover:text-th-primary focus:outline-none focus:ring-2 focus:ring-th disabled:opacity-60"
      >
        <span>{selectedOption?.label || effort}</span>
        <CaretDown size={10} className="shrink-0 text-th-muted" />
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 z-50 mb-2 w-40 overflow-hidden rounded-xl border border-th bg-th-elevated shadow-xl"
          role="listbox"
          aria-label="Effort"
        >
          {EFFORT_OPTIONS.map((option) => {
            const isSelected = option.id === effort;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setOpen(false);
                  onChange(option.id);
                }}
                className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-st-blue text-th-primary"
                    : "text-th-secondary hover:bg-th-muted hover:text-th-primary"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

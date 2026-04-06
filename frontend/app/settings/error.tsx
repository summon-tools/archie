"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Settings error boundary caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-th-surface rounded-2xl border border-th p-8">
          <h2 className="text-xl font-bold text-th-primary mb-2">
            Failed to load settings
          </h2>
          <p className="text-sm text-th-muted mb-6">
            Something went wrong while loading the settings page. Please try again.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={reset}
              className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover text-sm font-medium transition-colors"
            >
              Try again
            </button>
            <Link
              href="/"
              className="px-4 py-2 bg-th-subtle text-th-secondary border border-th rounded-lg hover:bg-th-muted text-sm font-medium transition-colors"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

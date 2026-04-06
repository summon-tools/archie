"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark">
      <body className="antialiased min-h-screen">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md text-center">
            <div className="bg-th-surface rounded-2xl border border-th p-8">
              <h2 className="text-xl font-bold text-th-primary mb-2">
                Something went wrong
              </h2>
              <p className="text-sm text-th-muted mb-6">
                A critical error occurred. Please try again.
              </p>
              <button
                onClick={reset}
                className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover text-sm font-medium transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

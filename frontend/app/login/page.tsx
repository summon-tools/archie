"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "@phosphor-icons/react";
import { getSetupStatus } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getSetupStatus()
      .then(async (status) => {
        if (status.needs_setup) {
          router.replace("/setup");
          return;
        }
        // Dev mode: auto-login without showing the form
        if (status.mode === "development") {
          try {
            const res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            if (res.ok) {
              router.push("/");
              router.refresh();
              return;
            }
          } catch {}
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Login failed — check your username and password");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed — check your username and password");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-th-muted text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-th-surface rounded-2xl border border-th backdrop-blur-sm p-8">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-th-strong rounded-xl flex items-center justify-center mx-auto mb-4">
              <Lock size={24} weight="bold" />
            </div>
            <h1 className="text-2xl font-bold text-th-primary">Dashboard</h1>
            <p className="text-sm text-th-dimmed mt-1">Sign in to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-th-secondary mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary placeholder-th focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent text-sm"
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-th-secondary mb-1"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary placeholder-th focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent text-sm"
                placeholder="Enter password"
              />
            </div>

            {error && (
              <div className="bg-st-red border border-st-red text-st-red text-sm px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-btn-primary text-btn-primary py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-btn-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

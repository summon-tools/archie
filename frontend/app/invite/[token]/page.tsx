"use client";

import { useState, useEffect, FormEvent, use } from "react";
import { getInviteInfo, acceptInvite } from "@/lib/api";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [email, setEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    getInviteInfo(token)
      .then((info) => {
        setEmail(info.email);
        setExpiresAt(info.expires_at);
      })
      .catch((err) => {
        setPageError(err.message || "Invalid invitation");
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      await acceptInvite(token, name, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-th-surface">
        <div className="text-th-muted text-sm">Loading...</div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-th-surface">
        <div className="bg-th-surface rounded-2xl border border-th p-8 max-w-md w-full mx-4 text-center">
          <h1 className="text-xl font-bold text-th-primary mb-2">Invalid Invitation</h1>
          <p className="text-sm text-th-muted mb-4">{pageError}</p>
          <a
            href="/login"
            className="text-sm text-th-secondary hover:text-th-primary underline"
          >
            Go to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-th-surface">
      <div className="bg-th-surface rounded-2xl border border-th p-8 max-w-md w-full mx-4">
        <h1 className="text-xl font-bold text-th-primary mb-1">Create Your Account</h1>
        <p className="text-sm text-th-dimmed mb-6">
          You&apos;ve been invited as <strong className="text-th-primary">{email}</strong>
        </p>

        {error && (
          <div className="bg-st-red border border-st-red text-st-red text-sm px-3 py-2 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-th-secondary mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-th-secondary mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              placeholder="Min 6 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-th-secondary mb-1">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              placeholder="Confirm your password"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !name || !password || !confirmPassword}
            className="w-full px-4 py-2.5 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
          >
            {submitting ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-xs text-th-dimmed mt-4 text-center">
          Invitation expires {new Date(expiresAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

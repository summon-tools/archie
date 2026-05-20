"use client";

import { useState, useEffect, useCallback } from "react";
import Header from "@/components/Header";
import { useTheme, Theme } from "@/components/ThemeProvider";
import { useToast } from "@/components/Toast";
import { disconnectGitHub, getGitHubConnection, type GitHubConnection } from "@/lib/api";
import { GithubLogo, LinkBreak, Sun, Moon, Monitor } from "@phosphor-icons/react";

export default function ProfilePage() {
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [disconnectingGithub, setDisconnectingGithub] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const [meRes, connection] = await Promise.all([
        fetch("/api/auth/me").then((r) => r.json()),
        getGitHubConnection().catch(() => ({ connected: false } as GitHubConnection)),
      ]);
      if (meRes.name) { setName(meRes.name); setSavedName(meRes.name); }
      if (meRes.email) setUserEmail(meRes.email);
      setGithubConnection(connection);
    } catch (err) {
      console.error("Failed to load profile:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const github = params.get("github");
    if (github === "connected") {
      toast.success("GitHub account connected");
      loadProfile();
    } else if (github === "error") {
      toast.error(params.get("message") || "GitHub connection failed");
    }

    if (github) {
      params.delete("github");
      params.delete("message");
      const nextQuery = params.toString();
      window.history.replaceState(null, "", nextQuery ? `/profile?${nextQuery}` : "/profile");
    }
  }, [loadProfile, toast]);

  const showMessage = (type: "success" | "error", text: string) => {
    toast[type](text);
  };

  const handleSaveName = async () => {
    if (!name.trim()) {
      showMessage("error", "Name is required");
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch("/api/auth/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to update name" }));
        throw new Error(err.detail);
      }
      setSavedName(name.trim());
      showMessage("success", "Name updated");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to update name");
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      showMessage("error", "New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage("error", "Passwords do not match");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to change password" }));
        throw new Error(err.detail);
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showMessage("success", "Password changed successfully");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    setDisconnectingGithub(true);
    try {
      const connection = await disconnectGitHub();
      setGithubConnection(connection);
      showMessage("success", "GitHub account disconnected");
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to disconnect GitHub");
    } finally {
      setDisconnectingGithub(false);
    }
  };

  if (loading) {
    return (
      <>
        <Header />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-40 bg-th-muted rounded-xl" />
            <div className="h-40 bg-th-muted rounded-xl" />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Account Info */}
        <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
          <h2 className="text-lg font-bold text-th-primary mb-1">Account</h2>
          <p className="text-sm text-th-dimmed mb-4">Your account details.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-th-secondary mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-th-secondary mb-1">Email</label>
              <div className="text-sm text-th-primary bg-th-subtle border border-th rounded-lg px-3 py-2">
                {userEmail || <span className="text-th-dimmed">Not set</span>}
              </div>
            </div>
            <button
              onClick={handleSaveName}
              disabled={savingName || !name.trim() || name.trim() === savedName}
              className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
            >
              {savingName ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* GitHub */}
        <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-th-primary mb-1">GitHub</h2>
              <p className="text-sm text-th-dimmed">
                Used for PR authorship, branch pushes, and pull request creation.
              </p>
            </div>
            <GithubLogo size={22} className="text-th-muted flex-shrink-0" />
          </div>

          {githubConnection?.connected ? (
            <div className="space-y-4">
              <div className="bg-th-subtle border border-th rounded-lg px-3 py-2">
                <p className="text-sm font-medium text-th-primary">
                  @{githubConnection.github_login}
                </p>
                <p className="text-xs text-th-dimmed">
                  {githubConnection.github_email || "Email not provided by GitHub"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/github/oauth/start"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover text-sm font-medium"
                >
                  <GithubLogo size={16} weight="bold" />
                  Reconnect
                </a>
                <button
                  onClick={handleDisconnectGitHub}
                  disabled={disconnectingGithub}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-th-subtle text-th-secondary border border-th rounded-lg hover:bg-th-muted disabled:opacity-50 text-sm font-medium"
                >
                  <LinkBreak size={16} weight="bold" />
                  {disconnectingGithub ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            </div>
          ) : (
            <a
              href="/api/github/oauth/start"
              className="inline-flex items-center gap-2 px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover text-sm font-medium"
            >
              <GithubLogo size={16} weight="bold" />
              Connect GitHub
            </a>
          )}
        </div>

        {/* Appearance */}
        <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
          <h2 className="text-lg font-bold text-th-primary mb-1">Appearance</h2>
          <p className="text-sm text-th-dimmed mb-4">
            Choose your preferred color theme.
          </p>
          <div className="flex gap-3">
            {(["light", "dark", "system"] as Theme[]).map((option) => (
              <button
                key={option}
                onClick={() => setTheme(option)}
                className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                  theme === option
                    ? "border-th-strong bg-btn-secondary text-btn-secondary"
                    : "border-th bg-th-subtle text-btn-ghost hover:bg-btn-ghost-hover hover:text-btn-ghost-hover"
                }`}
              >
                <div className="flex flex-col items-center gap-2">
                  {option === "light" && <Sun size={20} />}
                  {option === "dark" && <Moon size={20} />}
                  {option === "system" && <Monitor size={20} />}
                  <span className="capitalize">{option}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-th-surface rounded-2xl border border-th p-6 backdrop-blur-xl">
          <h2 className="text-lg font-bold text-th-primary mb-1">Change Password</h2>
          <p className="text-sm text-th-dimmed mb-4">
            Update your account password.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-th-secondary mb-1">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-th-secondary mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 6 characters)"
                className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-th-secondary mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg focus:ring-2 focus:ring-th focus:border-transparent text-sm text-th-primary"
              />
            </div>
            <button
              onClick={handleChangePassword}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="px-4 py-2 bg-btn-primary text-btn-primary rounded-lg hover:bg-btn-primary-hover disabled:opacity-50 text-sm font-medium"
            >
              {changingPassword ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

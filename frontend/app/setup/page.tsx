"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Gear, CheckCircle, Warning, XCircle, FolderOpen } from "@phosphor-icons/react";
import DirectoryPicker from "@/components/DirectoryPicker";
import { getSetupStatus, completeSetup, SetupStatus } from "@/lib/api";

const STEPS = ["Account", "Projects", "Git", "GitHub", "System"];

function GhSetupCheck() {
  const [status, setStatus] = useState<{ installed: boolean; authenticated: boolean; user: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/gh/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) return <p className="text-sm text-th-muted">Checking GitHub CLI...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {status.installed ? (
          <><CheckCircle size={16} weight="bold" className="text-st-green" /><span className="text-st-green">gh CLI installed</span></>
        ) : (
          <><XCircle size={16} weight="bold" className="text-st-red" /><span className="text-st-red">gh CLI not found</span></>
        )}
      </div>

      {status.installed && (
        <div className="flex items-center gap-2 text-sm">
          {status.authenticated ? (
            <><CheckCircle size={16} weight="bold" className="text-st-green" /><span className="text-st-green">Logged in as @{status.user}</span></>
          ) : (
            <><Warning size={16} weight="bold" className="text-st-amber" /><span className="text-st-amber">Not authenticated</span></>
          )}
        </div>
      )}

      {!status.installed && (
        <div className="bg-th-subtle border border-th rounded-lg p-3">
          <p className="text-xs text-th-secondary">
            Install: <code className="bg-th-code px-1 py-0.5 rounded">brew install gh</code>
          </p>
        </div>
      )}

      {status.installed && !status.authenticated && (
        <div className="bg-th-subtle border border-th rounded-lg p-3">
          <p className="text-xs text-th-secondary">
            Run in your terminal: <code className="bg-th-code px-1 py-0.5 rounded">gh auth login</code>
          </p>
        </div>
      )}

      <p className="text-xs text-th-dimmed">
        You can skip this step and set it up later in Settings. Push and PR features require gh authentication.
      </p>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                i < current
                  ? "bg-btn-primary text-btn-primary"
                  : i === current
                  ? "bg-btn-secondary text-btn-secondary border border-th-strong"
                  : "bg-th-subtle text-th-dimmed border border-th"
              }`}
            >
              {i < current ? (
                <Check size={16} weight="bold" />
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs mt-1 ${i === current ? "text-th-primary" : "text-th-dimmed"}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-px mb-5 ${i < current ? "bg-th-strong" : "bg-th-muted"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>("development");

  // Step 1: Account
  const [name, setName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isDevMode = mode === "development";

  // Step 2: Projects
  const [projectsDir, setProjectsDir] = useState("");
  const [showDirPicker, setShowDirPicker] = useState(false);

  // Step 3: Git
  const [gitName, setGitName] = useState("");
  const [gitEmail, setGitEmail] = useState("");

  // Step 4: SSH
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [existingPubKey, setExistingPubKey] = useState("");
  const [generateSshKey, setGenerateSshKey] = useState(false);

  // Step 5: System Readiness
  const [systemReadiness, setSystemReadiness] = useState<{
    tools: { name: string; status: string; version?: string; required: boolean; install_hint: string }[];
    providers: { id: string; label: string; available: boolean; error?: string }[];
  } | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);

  // Post-setup
  const [setupDone, setSetupDone] = useState(false);

  // Post-setup: redirect straight to dashboard
  useEffect(() => {
    if (setupDone) {
      router.push("/");
      router.refresh();
    }
  }, [setupDone, router]);

  useEffect(() => {
    getSetupStatus()
      .then((status: SetupStatus) => {
        if (!status.needs_setup) {
          router.replace("/");
          return;
        }
        setMode(status.mode || "development");
        setProjectsDir(status.default_projects_dir);
        setGitName(status.git_name);
        setGitEmail(status.git_email);
        // Pre-fill account name from git user.name in dev mode
        if (status.mode === "development" && status.git_name) {
          setName(status.git_name);
        }
        setHasExistingKey(status.has_ssh_key);
        setExistingPubKey(status.ssh_public_key);
        setLoading(false);
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  function validateStep(): string | null {
    if (step === 0) {
      if (!name.trim()) return "Name is required";
      if (!isDevMode) {
        if (!accountEmail.trim()) return "Email is required";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return "Invalid email format";
        if (password.length < 6) return "Password must be at least 6 characters";
        if (password !== confirmPassword) return "Passwords do not match";
      }
    }
    if (step === 1) {
      if (projectsDir && !projectsDir.startsWith("/") && !projectsDir.startsWith("~")) {
        return "Must be an absolute path";
      }
    }
    return null;
  }

  function handleNext() {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const nextStep = step + 1;
    setStep(nextStep);
    // Load readiness when entering System step
    if (nextStep === 4 && !systemReadiness) {
      loadReadiness();
    }
  }

  async function loadReadiness() {
    setLoadingReadiness(true);
    try {
      const res = await fetch("/api/setup/readiness");
      if (res.ok) {
        setSystemReadiness(await res.json());
      }
    } catch {}
    setLoadingReadiness(false);
  }

  function handleBack() {
    setError(null);
    setStep((s) => s - 1);
  }

  async function handleComplete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await completeSetup({
        name: name.trim(),
        ...(isDevMode ? {} : { email: accountEmail.trim(), password }),
        projects_dir: projectsDir,
        git_name: gitName,
        git_email: gitEmail,
        generate_ssh_key: generateSshKey,
      });

      setSetupDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-th-muted text-sm">Loading...</div>
      </div>
    );
  }

  if (setupDone) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-th-muted text-sm">Redirecting...</div>
      </div>
    );
  }

  const inputClass =
    "w-full px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary placeholder-th focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent text-sm";
  const labelClass = "block text-sm font-medium text-th-secondary mb-1";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-th-surface rounded-2xl border border-th backdrop-blur-sm p-8">
          <div className="text-center mb-2">
            <div className="w-12 h-12 bg-th-strong rounded-xl flex items-center justify-center mx-auto mb-4">
              <Gear size={24} weight="bold" />
            </div>
            <h1 className="text-2xl font-bold text-th-primary">Welcome to Archie</h1>
            <p className="text-sm text-th-dimmed mt-1">Let&apos;s get you set up</p>
          </div>

          <StepIndicator current={step} />

          <form onSubmit={step === 4 ? handleComplete : (e) => { e.preventDefault(); handleNext(); }}>
            {/* Step 1: Create Admin Account */}
            {step === 0 && (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 bg-st-blue/10 border border-st-blue/20 rounded-lg px-3 py-2.5">
                  <span className="text-st-blue mt-0.5 flex-shrink-0">ℹ</span>
                  <p className="text-xs text-st-blue">
                    {isDevMode
                      ? "Everything runs locally on your machine. No account or password needed."
                      : "This account is stored locally on your machine. Nothing is sent to any external service."}
                  </p>
                </div>
                <div>
                  <label htmlFor="name" className={labelClass}>Name</label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                    autoComplete="name"
                    className={inputClass}
                    placeholder="Your Name"
                  />
                </div>
                {!isDevMode && (
                  <>
                    <div>
                      <label htmlFor="accountEmail" className={labelClass}>Email</label>
                      <input
                        id="accountEmail"
                        type="email"
                        value={accountEmail}
                        onChange={(e) => setAccountEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className={inputClass}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div>
                      <label htmlFor="password" className={labelClass}>Password</label>
                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className={inputClass}
                        placeholder="At least 6 characters"
                      />
                    </div>
                    <div>
                      <label htmlFor="confirmPassword" className={labelClass}>Confirm Password</label>
                      <input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className={inputClass}
                        placeholder="Confirm your password"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Projects Directory */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="projectsDir" className={labelClass}>Projects Directory</label>
                  <p className="text-xs text-th-dimmed mb-2">
                    Where your project apps will be stored on disk.
                  </p>
                  <div className="flex gap-2">
                    <input
                      id="projectsDir"
                      type="text"
                      value={projectsDir}
                      onChange={(e) => setProjectsDir(e.target.value)}
                      autoFocus
                      className={`${inputClass} flex-1`}
                      placeholder="~/Projects"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDirPicker(true)}
                      className="px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-secondary hover:bg-th-muted hover:text-th-primary transition-colors flex-shrink-0"
                      title="Browse"
                    >
                      <FolderOpen size={18} />
                    </button>
                  </div>
                </div>
                {showDirPicker && (
                  <DirectoryPicker
                    initialPath={projectsDir || undefined}
                    requireGitRepo={false}
                    onSelect={(path) => {
                      setProjectsDir(path);
                      setShowDirPicker(false);
                    }}
                    onClose={() => setShowDirPicker(false)}
                  />
                )}
              </div>
            )}

            {/* Step 3: Git Identity */}
            {step === 2 && (
              <div className="space-y-4">
                <p className="text-xs text-th-dimmed">
                  Used for git commits. Leave blank to skip.
                </p>
                <div>
                  <label htmlFor="gitName" className={labelClass}>Name</label>
                  <input
                    id="gitName"
                    type="text"
                    value={gitName}
                    onChange={(e) => setGitName(e.target.value)}
                    autoFocus
                    className={inputClass}
                    placeholder="Your Name"
                  />
                </div>
                <div>
                  <label htmlFor="gitEmail" className={labelClass}>Email</label>
                  <input
                    id="gitEmail"
                    type="email"
                    value={gitEmail}
                    onChange={(e) => setGitEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </div>
              </div>
            )}

            {/* Step 4: GitHub CLI */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-xs text-th-dimmed">
                  Archie uses the GitHub CLI to push code and create pull requests.
                </p>
                <GhSetupCheck />
              </div>
            )}

            {/* Step 5: System Readiness */}
            {step === 4 && (
              <div className="space-y-4">
                <p className="text-xs text-th-dimmed">
                  Verify system tools and AI providers are available.
                </p>
                {loadingReadiness ? (
                  <div className="text-sm text-th-muted">Checking system...</div>
                ) : systemReadiness ? (
                  <>
                    <div>
                      <h4 className="text-sm font-medium text-th-secondary mb-2">Tools</h4>
                      <div className="space-y-1.5">
                        {systemReadiness.tools.map((tool) => (
                          <div key={tool.name} className="flex items-center gap-2 text-sm">
                            {tool.status === "ok" ? (
                              <CheckCircle size={16} weight="bold" className="text-st-green flex-shrink-0" />
                            ) : tool.required ? (
                              <XCircle size={16} weight="bold" className="text-st-red flex-shrink-0" />
                            ) : (
                              <Warning size={16} weight="bold" className="text-st-yellow flex-shrink-0" />
                            )}
                            <span className="text-th-primary">{tool.name}</span>
                            {tool.version && (
                              <span className="text-xs text-th-dimmed">{tool.version}</span>
                            )}
                            {tool.status === "missing" && !tool.required && (
                              <span className="text-xs text-th-dimmed">(optional)</span>
                            )}
                            {tool.status === "missing" && tool.required && (
                              <span className="text-xs text-st-red">(required)</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-th-secondary mb-2">AI Providers</h4>
                      <div className="space-y-1.5">
                        {systemReadiness.providers.map((provider) => (
                          <div key={provider.id} className="flex items-center gap-2 text-sm">
                            {provider.available ? (
                              <CheckCircle size={16} weight="bold" className="text-st-green flex-shrink-0" />
                            ) : (
                              <XCircle size={16} weight="bold" className="text-st-red flex-shrink-0" />
                            )}
                            <span className="text-th-primary">{provider.label}</span>
                            {!provider.available && provider.error && (
                              <span className="text-xs text-st-red">{provider.error}</span>
                            )}
                          </div>
                        ))}
                        {systemReadiness.providers.every((p) => !p.available) && (
                          <p className="text-xs text-st-red mt-1">
                            At least one AI provider must be available. Run &quot;claude auth login&quot; to set up Claude.
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={loadReadiness}
                      className="text-xs text-st-blue hover:underline"
                    >
                      Refresh checks
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-th-muted">Could not load system readiness.</p>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 bg-st-red border border-st-red text-st-red text-sm px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex gap-3 mt-6">
              {step > 0 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex-1 bg-th-subtle text-th-primary py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-th-muted transition-colors border border-th"
                >
                  Back
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-btn-primary text-btn-primary py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-btn-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {step === 4
                  ? submitting
                    ? "Setting up..."
                    : "Complete Setup"
                  : "Next"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GithubLogo, FolderOpen, SpinnerGap } from "@phosphor-icons/react";
import useSWR from "swr";
import { importApp, getSettings, getMe } from "@/lib/api";
import Header from "@/components/Header";
import DirectoryPicker from "@/components/DirectoryPicker";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { fetcher } from "@/lib/swr";

interface ModelConfig {
  availableModels: { id: string; label: string; provider: string }[];
}

export default function CreateAppPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"import" | "local">("import");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import form state
  const [githubUrl, setGithubUrl] = useState("");
  const [importDescription, setImportDescription] = useState("");

  // Local import form state
  const [localPath, setLocalPath] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  // Model selection (same as discussions — provider-aware)
  const { selectedModel, selectedProvider, handleModelChange } = useSelectedModel();
  const { data: modelConfig } = useSWR<ModelConfig>("/api/models/config", fetcher);

  // Admin guard: redirect members to /
  useEffect(() => {
    getMe().then((me) => {
      if (me.role !== "admin") router.replace("/");
    }).catch(() => {});
  }, [router]);

  // Projects dir from settings
  const [projectsDir, setProjectsDir] = useState("~");
  useEffect(() => {
    getSettings().then((s) => setProjectsDir(s.computed.projects_dir)).catch(() => {});
  }, []);

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await importApp({
        github_url: githubUrl.trim(),
        description: importDescription.trim() || undefined,
      });
      // Redirect to the conversation page for interactive setup
      router.push(`/apps/${result.app.id}/conversation/${result.work_item_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import app");
      setSubmitting(false);
    }
  }

  async function handleLocalImport(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await importApp({
        local_path: localPath.trim(),
      });
      // Redirect to the conversation page for interactive setup
      router.push(`/apps/${result.app.id}/conversation/${result.work_item_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link local repo");
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header />

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-th-surface rounded-2xl border border-th overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-th">
            <button
              onClick={() => { setMode("import"); setError(null); }}
              className={`flex-1 px-6 py-3.5 text-sm font-medium transition relative ${
                mode === "import"
                  ? "text-th-primary"
                  : "text-th-muted hover:text-th-primary"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <GithubLogo size={16} weight="fill" />
                Import from GitHub
              </span>
              {mode === "import" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-th-strong" />
              )}
            </button>
            <button
              onClick={() => { setMode("local"); setError(null); }}
              className={`flex-1 px-6 py-3.5 text-sm font-medium transition relative ${
                mode === "local"
                  ? "text-th-primary"
                  : "text-th-muted hover:text-th-primary"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <FolderOpen size={16} weight="bold" />
                Link Local Repo
              </span>
              {mode === "local" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-th-strong" />
              )}
            </button>
          </div>

          <div className="p-8">
            {/* Error display */}
            {error && (
              <div className="bg-st-red border border-st-red text-st-red text-sm px-3 py-2 rounded-lg mb-6">
                {error}
              </div>
            )}

            {/* Import from GitHub tab */}
            {mode === "import" && (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-th-primary">Import from GitHub</h2>
                  <p className="text-sm text-th-dimmed mt-1">Clone an existing repository and add it to your dashboard</p>
                </div>

                <form onSubmit={handleImport} className="space-y-5">
                  <div>
                    <label htmlFor="github-url" className="block text-sm font-medium text-th-secondary mb-1">
                      GitHub Repository URL
                    </label>
                    <input
                      id="github-url"
                      type="text"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      required
                      autoFocus
                      className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary placeholder-th focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent text-sm font-mono"
                      placeholder="https://github.com/username/repo"
                    />
                    <p className="text-xs text-th-muted mt-1">
                      HTTPS or SSH URL — will be converted to SSH for cloning
                    </p>
                  </div>

                  <div>
                    <label htmlFor="import-desc" className="block text-sm font-medium text-th-secondary mb-1">
                      Description <span className="text-th-muted font-normal">(optional)</span>
                    </label>
                    <textarea
                      id="import-desc"
                      value={importDescription}
                      onChange={(e) => setImportDescription(e.target.value)}
                      maxLength={5000}
                      rows={3}
                      className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary placeholder-th focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent text-sm"
                      placeholder="Short description of the app (will try to read from package.json if empty)"
                    />
                  </div>

                  <ModelSelect
                    id="import-model"
                    value={`${selectedProvider}:${selectedModel}`}
                    onChange={handleModelChange}
                    models={modelConfig?.availableModels}
                  />

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={submitting || !githubUrl.trim()}
                      className="px-6 py-2.5 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2 text-sm transition"
                    >
                      {submitting ? (
                        <>
                          <SpinnerGap size={16} className="animate-spin" />
                          Cloning...
                        </>
                      ) : (
                        "Import Repository"
                      )}
                    </button>
                    <span className="text-xs text-th-muted">
                      Requires SSH key to be added to GitHub
                    </span>
                  </div>
                </form>
              </>
            )}

            {/* Link Local Repo tab */}
            {mode === "local" && (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-semibold text-th-primary">Link Local Repository</h2>
                  <p className="text-sm text-th-dimmed mt-1">Point to an existing git repo on your machine</p>
                </div>

                <form onSubmit={handleLocalImport} className="space-y-5">
                  <div>
                    <label htmlFor="local-path" className="block text-sm font-medium text-th-secondary mb-1">
                      Directory Path
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="local-path"
                        type="text"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        required
                        className="flex-1 px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary placeholder-th focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent text-sm font-mono"
                        placeholder="/Users/you/Projects/my-app"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPicker(true)}
                        className="px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-secondary hover:text-th-primary hover:bg-th-muted transition-colors flex items-center gap-1.5 text-sm flex-shrink-0"
                      >
                        <FolderOpen size={16} />
                        Browse
                      </button>
                    </div>
                    <p className="text-xs text-th-muted mt-1">
                      Absolute path to an existing git repository
                    </p>
                  </div>

                  <ModelSelect
                    id="local-model"
                    value={`${selectedProvider}:${selectedModel}`}
                    onChange={handleModelChange}
                    models={modelConfig?.availableModels}
                  />

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={submitting || !localPath.trim()}
                      className="px-6 py-2.5 bg-btn-secondary text-btn-secondary rounded-lg hover:bg-btn-secondary-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2 text-sm transition"
                    >
                      {submitting ? (
                        <>
                          <SpinnerGap size={16} className="animate-spin" />
                          Linking...
                        </>
                      ) : (
                        <>
                          <FolderOpen size={16} weight="bold" />
                          Link Repository
                        </>
                      )}
                    </button>
                    <span className="text-xs text-th-muted">
                      The AI will detect the stack and set up the project
                    </span>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>

        {mode === "import" && (
          <div className="mt-6 bg-th-subtle rounded-xl border border-th p-6">
            <h3 className="text-sm font-semibold text-th-secondary mb-3">Before importing</h3>
            <ul className="text-sm text-th-dimmed space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>Make sure your <strong>SSH key</strong> is added to GitHub (check Settings &rarr; Git)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>The repository will be cloned to <strong>{projectsDir}/repo-name/</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>The AI will <strong>auto-setup</strong> the project — install deps, create start/stop scripts, and verify it runs</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>A port will be <strong>auto-assigned</strong> and configured for the project</span>
              </li>
            </ul>
          </div>
        )}

        {mode === "local" && (
          <div className="mt-6 bg-th-subtle rounded-xl border border-th p-6">
            <h3 className="text-sm font-semibold text-th-secondary mb-3">How it works</h3>
            <ul className="text-sm text-th-dimmed space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>The directory must be an existing <strong>git repository</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>Your project is used <strong>in-place</strong> — nothing is copied or cloned</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>The AI will <strong>detect the tech stack</strong>, install dependencies, and verify the app runs</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-th-dimmed mt-0.5">&#x2022;</span>
                <span>A port will be <strong>auto-assigned</strong> and configured for the project</span>
              </li>
            </ul>
          </div>
        )}
      </main>

      {showPicker && (
        <DirectoryPicker
          initialPath={localPath || projectsDir}
          onSelect={(path) => setLocalPath(path)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

function ModelSelect({
  id,
  value,
  onChange,
  models,
}: {
  id: string;
  value: string;
  onChange: (provider: string, model: string) => void;
  models?: { id: string; label: string; provider: string }[];
}) {
  const grouped = (models || []).reduce<Record<string, { id: string; label: string; provider: string }[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-th-secondary mb-1">Model</label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const [p, ...rest] = e.target.value.split(":");
          onChange(p, rest.join(":"));
        }}
        className="w-full px-3 py-2 bg-th-subtle border border-th rounded-lg text-th-primary text-sm focus:outline-none focus:ring-2 focus:ring-th focus:border-transparent appearance-none"
      >
        {Object.entries(grouped).map(([provider, providerModels]) => (
          <optgroup key={provider} label={provider}>
            {providerModels.map((m) => (
              <option key={`${provider}:${m.id}`} value={`${provider}:${m.id}`}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

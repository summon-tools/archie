"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { App } from "@/lib/types";
import { getApps, getSetupStatus, getMe } from "@/lib/api";
import AppCard from "@/components/AppCard";
import Header from "@/components/Header";

interface TeamUser {
  id: number;
  name: string;
}

export default function Home() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  useEffect(() => {
    getSetupStatus()
      .then((s) => {
        if (s.needs_setup) router.replace("/setup");
        else setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  const [apps, setApps] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getMe()
      .then((me) => setRole(me.role))
      .catch(() => {});

    fetch("/api/users", { credentials: "include" })
      .then((r) => r.json())
      .then((d) =>
        setUsers((d.users || []).map((u: any) => ({ id: u.id, name: u.name })))
      )
      .catch(() => {});
  }, []);

  const loadApps = useCallback(() => {
    getApps()
      .then(setApps)
      .catch(() => {})
      .finally(() => setAppsLoading(false));
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const userById = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of users) map.set(u.id, u.name);
    return map;
  }, [users]);

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((app) => {
      const owner =
        app.project_owner_user_id != null
          ? userById.get(app.project_owner_user_id) ?? ""
          : "";
      return (
        app.name.toLowerCase().includes(q) ||
        (app.description ?? "").toLowerCase().includes(q) ||
        owner.toLowerCase().includes(q)
      );
    });
  }, [apps, search, userById]);

  const stats = useMemo(() => {
    let activeConversations = 0;
    let runningApps = 0;
    let previewsRunning = 0;
    for (const app of apps) {
      activeConversations += app.conversation_stats.open;
      previewsRunning += app.conversation_stats.previews_running;
      if (app.is_running) runningApps += 1;
    }
    return {
      totalApps: apps.length,
      activeConversations,
      runningApps: runningApps + previewsRunning,
    };
  }, [apps]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-th-muted text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-th-surface">
      <Header />
      <div className="px-6 md:px-10 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h2 className="text-xl font-semibold text-th-primary flex items-baseline gap-2 flex-wrap">
            <span>Your Projects</span>
            {!appsLoading && (
              <span className="text-sm font-normal text-th-dimmed">
                {stats.totalApps} app{stats.totalApps !== 1 ? "s" : ""}
                {" · "}
                {stats.activeConversations} active conversation
                {stats.activeConversations !== 1 ? "s" : ""}
                {" · "}
                {stats.runningApps} active server
                {stats.runningApps !== 1 ? "s" : ""}
              </span>
            )}
          </h2>
          <div className="relative w-full sm:w-72">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-th-dimmed pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, description, owner…"
              className="w-full text-sm bg-transparent text-th-primary placeholder:text-th-dimmed border border-th rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-brand-400"
            />
          </div>
        </div>

        {appsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-th-surface rounded-2xl border border-th p-6 animate-pulse"
              >
                <div className="h-6 bg-th-muted rounded w-1/2 mb-3" />
                <div className="h-4 bg-th-subtle rounded w-3/4 mb-5" />
                <div className="h-3 bg-th-subtle rounded w-full" />
              </div>
            ))}
          </div>
        )}

        {!appsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredApps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onUpdate={loadApps}
                ownerName={
                  app.project_owner_user_id != null
                    ? userById.get(app.project_owner_user_id) ?? null
                    : null
                }
              />
            ))}

            {role === "admin" && !search && (
              <Link href="/apps/new">
                <div className="bg-th-surface rounded-xl border-2 border-dashed border-th px-5 py-4 hover:border-th-strong hover:bg-th-subtle transition-all duration-200 cursor-pointer h-full flex flex-col items-center justify-center gap-2">
                  <div className="w-10 h-10 bg-th-muted rounded-xl flex items-center justify-center flex-shrink-0">
                    <Plus size={20} />
                  </div>
                  <span className="text-sm font-medium text-th-secondary">Add App</span>
                </div>
              </Link>
            )}
          </div>
        )}

        {!appsLoading && apps.length === 0 && (
          <div className="text-center py-8 text-th-muted">
            <p className="text-sm">No apps found</p>
          </div>
        )}

        {!appsLoading && apps.length > 0 && filteredApps.length === 0 && (
          <div className="text-center py-8 text-th-muted">
            <p className="text-sm">No apps match &ldquo;{search}&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}

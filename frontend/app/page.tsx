"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "@phosphor-icons/react";
import { App } from "@/lib/types";
import { getApps, getSetupStatus, getMe } from "@/lib/api";
import AppCard from "@/components/AppCard";
import Header from "@/components/Header";

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

  useEffect(() => {
    getMe()
      .then((me) => setRole(me.role))
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
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-th-primary">Your Projects</h2>
        </div>

        {appsLoading && (
          <div className="flex flex-col gap-4">
            {[1, 2].map((i) => (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} onUpdate={loadApps} isAdmin={role === "admin"} />
            ))}

            {role === "admin" && <Link href="/apps/new">
              <div className="bg-th-surface rounded-xl border-2 border-dashed border-th px-5 py-4 hover:border-th-strong hover:bg-th-subtle transition-all duration-200 cursor-pointer h-full flex flex-col items-center justify-center gap-2">
                <div className="w-10 h-10 bg-th-muted rounded-xl flex items-center justify-center flex-shrink-0">
                  <Plus size={20} />
                </div>
                <span className="text-sm font-medium text-th-secondary">Add App</span>
              </div>
            </Link>}
          </div>
        )}

        {!appsLoading && apps.length === 0 && (
          <div className="text-center py-8 text-th-muted">
            <p className="text-sm">No apps found</p>
          </div>
        )}
      </div>
    </div>
  );
}

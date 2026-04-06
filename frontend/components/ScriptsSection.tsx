"use client";

import useSWR from "swr";
import { ScriptContents } from "@/lib/api";
import { fetcher } from "@/lib/swr";

interface ScriptsSectionProps {
  appId: number;
}

export default function ScriptsSection({ appId }: ScriptsSectionProps) {
  const { data: scripts, isLoading: loading } = useSWR<ScriptContents>(
    `/api/apps/${appId}/scripts`,
    fetcher,
  );

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-th-muted rounded w-20" />
        <div className="h-24 bg-th-subtle rounded-lg" />
        <div className="h-4 bg-th-muted rounded w-16 mt-3" />
        <div className="h-24 bg-th-subtle rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* start.sh */}
      <div>
        <h4 className="text-xs font-medium text-th-muted mb-1.5">.archie/start.sh</h4>
        {scripts?.start_sh ? (
          <pre className="text-xs font-mono text-th-secondary bg-th-subtle border border-th rounded-lg p-3 overflow-x-auto whitespace-pre max-h-64 overflow-y-auto">
            {scripts.start_sh}
          </pre>
        ) : (
          <p className="text-xs text-th-dimmed italic">Script not found</p>
        )}
      </div>

      {/* stop.sh */}
      <div>
        <h4 className="text-xs font-medium text-th-muted mb-1.5">.archie/stop.sh</h4>
        {scripts?.stop_sh ? (
          <pre className="text-xs font-mono text-th-secondary bg-th-subtle border border-th rounded-lg p-3 overflow-x-auto whitespace-pre max-h-64 overflow-y-auto">
            {scripts.stop_sh}
          </pre>
        ) : (
          <p className="text-xs text-th-dimmed italic">Script not found</p>
        )}
      </div>
    </div>
  );
}

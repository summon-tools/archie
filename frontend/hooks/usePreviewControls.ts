"use client";

import { useState, useCallback } from "react";
import { Task } from "@/lib/types";
import {
  getWorkItem,
  startPreview,
  stopPreview,
  restartPreview,
} from "@/lib/api";

interface UsePreviewControlsOptions {
  appId: number;
  workItem: Task;
  setWorkItem: (workItem: Task) => void;
  onItemUpdate: () => void;
}

export function usePreviewControls({
  appId,
  workItem,
  setWorkItem,
  onItemUpdate,
}: UsePreviewControlsOptions) {
  const [startingPreview, setStartingPreview] = useState(false);
  const [stoppingPreview, setStoppingPreview] = useState(false);
  const [restartingPreview, setRestartingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handleStartPreview = useCallback(async () => {
    setStartingPreview(true);
    setPreviewError(null);
    try {
      await startPreview(appId, workItem.id);
      const updated = await getWorkItem(appId, workItem.id);
      setWorkItem(updated);
      onItemUpdate();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to start preview");
    } finally {
      setStartingPreview(false);
    }
  }, [appId, workItem.id, setWorkItem, onItemUpdate]);

  const handleStopPreview = useCallback(async () => {
    setStoppingPreview(true);
    setPreviewError(null);
    try {
      await stopPreview(appId, workItem.id);
      const updated = await getWorkItem(appId, workItem.id);
      setWorkItem(updated);
      onItemUpdate();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to stop preview");
    } finally {
      setStoppingPreview(false);
    }
  }, [appId, workItem.id, setWorkItem, onItemUpdate]);

  const handleRestartPreview = useCallback(async () => {
    setRestartingPreview(true);
    setPreviewError(null);
    try {
      await restartPreview(appId, workItem.id);
      const updated = await getWorkItem(appId, workItem.id);
      setWorkItem(updated);
      onItemUpdate();
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to restart preview");
    } finally {
      setRestartingPreview(false);
    }
  }, [appId, workItem.id, setWorkItem, onItemUpdate]);

  return {
    startPreview: handleStartPreview,
    stopPreview: handleStopPreview,
    restartPreview: handleRestartPreview,
    startingPreview,
    stoppingPreview,
    restartingPreview,
    previewError,
    setPreviewError,
  };
}

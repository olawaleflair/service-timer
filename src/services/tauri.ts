import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DisplayInfo, StagePayload } from "../types";
import { isTauriRuntime } from "./runtime";

export interface NativeStageStatus {
  opened: boolean;
  connected: boolean;
  message: string;
}

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!isTauriRuntime() && fallback !== undefined) return fallback;
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export async function listDisplays(): Promise<DisplayInfo[]> {
  return safeInvoke<DisplayInfo[]>("list_displays", undefined, [
    {
      id: "primary",
      name: "Primary display",
      isPrimary: true,
      width: window.screen.width,
      height: window.screen.height,
      scaleFactor: window.devicePixelRatio || 1,
      connected: true,
    },
  ]);
}

export async function openStageDisplay(displayId: string, testMode = false): Promise<void> {
  if (!isTauriRuntime()) return;
  await safeInvoke("open_stage_display", { displayId, testMode }, undefined);
}

export async function closeStageDisplay(): Promise<void> {
  if (!isTauriRuntime()) return;
  await safeInvoke("close_stage_display", undefined, undefined);
}

export async function closeApplication(): Promise<void> {
  await safeInvoke("close_application", undefined, undefined);
}

export async function setMainCloseGuard(guarded: boolean): Promise<void> {
  await safeInvoke("set_main_close_guard", { guarded }, undefined);
}

export async function publishStagePayload(payload: StagePayload): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem("service-timer-stage-payload", JSON.stringify(payload));
    window.dispatchEvent(new StorageEvent("storage", { key: "service-timer-stage-payload" }));
    return;
  }
  try {
    await invoke("set_stage_payload", { payload });
  } catch {
    localStorage.setItem("service-timer-stage-payload", JSON.stringify(payload));
    window.dispatchEvent(new StorageEvent("storage", { key: "service-timer-stage-payload" }));
    await emit("stage-payload", payload).catch(() => undefined);
  }
}

export async function getStagePayload(): Promise<StagePayload | null> {
  if (!isTauriRuntime()) {
    const raw = localStorage.getItem("service-timer-stage-payload");
    return raw ? (JSON.parse(raw) as StagePayload) : null;
  }
  try {
    return await invoke<StagePayload | null>("get_stage_payload");
  } catch {
    const raw = localStorage.getItem("service-timer-stage-payload");
    return raw ? (JSON.parse(raw) as StagePayload) : null;
  }
}

export async function onStagePayload(callback: (payload: StagePayload) => void): Promise<() => void> {
  const unlisten = isTauriRuntime()
    ? await listen<StagePayload>("stage-payload", (event) => callback(event.payload)).catch(() => null)
    : null;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "service-timer-stage-payload") return;
    const raw = localStorage.getItem("service-timer-stage-payload");
    if (raw) callback(JSON.parse(raw) as StagePayload);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unlisten?.();
    window.removeEventListener("storage", onStorage);
  };
}

export async function onStageStatus(callback: (status: NativeStageStatus) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const unlisten = await listen<NativeStageStatus>("stage-status", (event) => callback(event.payload)).catch(
    () => null,
  );
  return () => unlisten?.();
}

export async function onMainCloseRequested(shouldPreventClose: () => boolean): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const unlistenNative = await listen("main-close-requested", () => {
    shouldPreventClose();
  }).catch(() => null);
  const unlistenWindow = await getCurrentWindow().onCloseRequested((event) => {
    if (shouldPreventClose()) {
      event.preventDefault();
    }
  });
  return () => {
    unlistenNative?.();
    unlistenWindow();
  };
}

export async function checkForUpdate(): Promise<{ available: boolean; message: string }> {
  return safeInvoke("check_for_update", undefined, {
    available: false,
    message: "Update endpoint is not configured yet.",
  });
}

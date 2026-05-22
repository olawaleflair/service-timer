import { load, type Store } from "@tauri-apps/plugin-store";
import type { ActiveService, ServiceReport, Settings, Template } from "../types";
import { recoverServicePaused } from "../utils/timer";
import { isTauriRuntime } from "./runtime";

const STORE_PATH = "service-timer.json";
const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  soundAlerts: false,
  autoMoveToNextSection: false,
  defaultWarningTimeSeconds: 300,
  lastSelectedDisplayId: null,
};

export interface PersistedData {
  settings: Settings;
  templates: Template[];
  reports: ServiceReport[];
  activeService: ActiveService | null;
}

let storePromise: Promise<Store> | null = null;

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}

export async function loadPersistedData(): Promise<PersistedData> {
  const fallback = readLocal();
  try {
    const store = await getStore();
    const [settings, templates, reports, activeService] = await Promise.all([
      store.get<Settings>("settings"),
      store.get<Template[]>("templates"),
      store.get<ServiceReport[]>("reports"),
      store.get<ActiveService | null>("activeService"),
    ]);
    return normalize({
      settings: settings ?? fallback.settings,
      templates: templates ?? fallback.templates,
      reports: reports ?? fallback.reports,
      activeService: activeService ?? fallback.activeService,
    });
  } catch (error) {
    if (isTauriRuntime()) console.warn("Store read failed; using localStorage fallback.", error);
    return normalize(fallback);
  }
}

export async function savePersistedData(data: PersistedData): Promise<void> {
  writeLocal(data);
  try {
    const store = await getStore();
    await store.set("settings", data.settings);
    await store.set("templates", data.templates);
    await store.set("reports", data.reports);
    await store.set("activeService", data.activeService);
    await store.save();
  } catch (error) {
    if (isTauriRuntime()) console.warn("Store write failed; localStorage fallback has been updated.", error);
  }
}

function getStore(): Promise<Store> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error("Tauri runtime unavailable."));
  }
  storePromise ??= load(STORE_PATH, { autoSave: false, defaults: {} });
  return storePromise;
}

function normalize(data: PersistedData): PersistedData {
  const active = data.activeService && data.activeService.status !== "ended"
    ? recoverServicePaused(data.activeService)
    : null;

  return {
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    templates: Array.isArray(data.templates) ? data.templates : [],
    reports: Array.isArray(data.reports) ? data.reports : [],
    activeService: active,
  };
}

function readLocal(): PersistedData {
  try {
    const raw = localStorage.getItem(STORE_PATH);
    if (!raw) {
      return { settings: defaultSettings(), templates: [], reports: [], activeService: null };
    }
    return JSON.parse(raw) as PersistedData;
  } catch {
    return { settings: defaultSettings(), templates: [], reports: [], activeService: null };
  }
}

function writeLocal(data: PersistedData): void {
  try {
    localStorage.setItem(STORE_PATH, JSON.stringify(data));
  } catch (error) {
    console.warn("localStorage write failed.", error);
  }
}

import { load, type Store } from "@tauri-apps/plugin-store";
import type { ActiveService, ServiceReport, Settings, Template } from "../types";
import { recoverServicePaused } from "../utils/timer";
import { isTauriRuntime } from "./runtime";

const STORE_PATH = "service-timer.json";
const DEFAULT_SETTINGS: Settings = {
  soundAlerts: false,
  autoMoveToNextSection: false,
  defaultWarningTimeSeconds: 120,
  lastSelectedDisplayId: null,
};
export const SETTINGS_MIGRATION_VERSION = 1;

export interface PersistedData {
  settings: Settings;
  templates: Template[];
  reports: ServiceReport[];
  activeService: ActiveService | null;
  settingsMigrationVersion?: number;
}

let storePromise: Promise<Store> | null = null;

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}

export async function loadPersistedData(): Promise<PersistedData> {
  const fallback = readLocal();
  try {
    const store = await getStore();
    const [settings, templates, reports, activeService, settingsMigrationVersion] = await Promise.all([
      store.get<Settings>("settings"),
      store.get<Template[]>("templates"),
      store.get<ServiceReport[]>("reports"),
      store.get<ActiveService | null>("activeService"),
      store.get<number>("settingsMigrationVersion"),
    ]);
    return normalizePersistedData({
      settings: settings ?? fallback.settings,
      templates: templates ?? fallback.templates,
      reports: reports ?? fallback.reports,
      activeService: activeService ?? fallback.activeService,
      settingsMigrationVersion: settingsMigrationVersion ?? fallback.settingsMigrationVersion,
    });
  } catch (error) {
    if (isTauriRuntime()) console.warn("Store read failed; using localStorage fallback.", error);
    return normalizePersistedData(fallback);
  }
}

export async function savePersistedData(data: PersistedData): Promise<void> {
  const persisted = { ...data, settingsMigrationVersion: SETTINGS_MIGRATION_VERSION };
  writeLocal(persisted);
  try {
    const store = await getStore();
    await store.set("settings", persisted.settings);
    await store.set("templates", persisted.templates);
    await store.set("reports", persisted.reports);
    await store.set("activeService", persisted.activeService);
    await store.set("settingsMigrationVersion", SETTINGS_MIGRATION_VERSION);
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

export function normalizePersistedData(data: PersistedData): PersistedData {
  const active = data.activeService && data.activeService.status !== "ended"
    ? recoverServicePaused(data.activeService)
    : null;
  const settings: Settings = {
    soundAlerts: data.settings?.soundAlerts ?? DEFAULT_SETTINGS.soundAlerts,
    autoMoveToNextSection: data.settings?.autoMoveToNextSection ?? DEFAULT_SETTINGS.autoMoveToNextSection,
    defaultWarningTimeSeconds: data.settings?.defaultWarningTimeSeconds ?? DEFAULT_SETTINGS.defaultWarningTimeSeconds,
    lastSelectedDisplayId: data.settings?.lastSelectedDisplayId ?? DEFAULT_SETTINGS.lastSelectedDisplayId,
  };

  // Convert only data written before the default changed. Once the marker is
  // present, a user's intentional five-minute setting must be preserved.
  if ((data.settingsMigrationVersion ?? 0) < SETTINGS_MIGRATION_VERSION && settings.defaultWarningTimeSeconds === 300) {
    settings.defaultWarningTimeSeconds = DEFAULT_SETTINGS.defaultWarningTimeSeconds;
  }

  return {
    settings,
    templates: Array.isArray(data.templates) ? data.templates : [],
    reports: Array.isArray(data.reports) ? data.reports : [],
    activeService: active,
    settingsMigrationVersion: SETTINGS_MIGRATION_VERSION,
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

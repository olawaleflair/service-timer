import { describe, expect, it } from "vitest";
import type { PersistedData } from "../persistence";
import { normalizePersistedData, SETTINGS_MIGRATION_VERSION } from "../persistence";

function persisted(defaultWarningTimeSeconds: number, settingsMigrationVersion?: number): PersistedData {
  return {
    settings: {
      theme: "dark",
      soundAlerts: false,
      autoMoveToNextSection: false,
      defaultWarningTimeSeconds,
      lastSelectedDisplayId: null,
    },
    templates: [],
    reports: [],
    activeService: null,
    settingsMigrationVersion,
  };
}

describe("persistence settings migration", () => {
  it("updates the old built-in five-minute default once", () => {
    const normalized = normalizePersistedData(persisted(300));

    expect(normalized.settings.defaultWarningTimeSeconds).toBe(120);
    expect(normalized.settingsMigrationVersion).toBe(SETTINGS_MIGRATION_VERSION);
  });

  it("preserves an intentional five-minute setting after migration", () => {
    const normalized = normalizePersistedData(persisted(300, SETTINGS_MIGRATION_VERSION));

    expect(normalized.settings.defaultWarningTimeSeconds).toBe(300);
  });
});

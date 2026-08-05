import { describe, expect, it } from "vitest";
import type { PersistedData } from "../persistence";
import { normalizePersistedData, SETTINGS_MIGRATION_VERSION } from "../persistence";

function persisted(defaultWarningTimeSeconds: number, settingsMigrationVersion?: number): PersistedData {
  return {
    settings: {
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

  it("loads settings without a theme field", () => {
    const normalized = normalizePersistedData(persisted(120, SETTINGS_MIGRATION_VERSION));

    expect(normalized.settings).toEqual({
      soundAlerts: false,
      autoMoveToNextSection: false,
      defaultWarningTimeSeconds: 120,
      lastSelectedDisplayId: null,
    });
  });

  it("drops a legacy theme field during normalization", () => {
    const legacy = persisted(120, SETTINGS_MIGRATION_VERSION) as PersistedData & {
      settings: PersistedData["settings"] & { theme: string };
    };
    legacy.settings.theme = "dark";

    const normalized = normalizePersistedData(legacy);

    expect(normalized.settings).not.toHaveProperty("theme");
  });
});

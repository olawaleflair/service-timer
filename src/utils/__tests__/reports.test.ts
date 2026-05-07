import { describe, expect, it } from "vitest";
import type { ActiveService } from "../../types";
import { generateReport, keepLatestReports } from "../reports";

describe("reports", () => {
  it("builds planned versus actual report data", () => {
    const service: ActiveService = {
      id: "svc",
      name: "Sunday Service",
      date: "2026-05-07",
      warningThresholdSeconds: 300,
      autoMoveToNextSection: false,
      currentSectionId: "s1",
      status: "paused",
      stageDisplayOpenedOnce: true,
      stageDisplayHidden: false,
      selectedDisplayId: "display",
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
      sections: [
        {
          id: "s1",
          name: "Sermon",
          originalDurationSeconds: 600,
          adjustedDurationSeconds: 660,
          addedSeconds: 60,
          reducedSeconds: 0,
          actualElapsedSeconds: 720,
          status: "completed",
          startedAt: null,
          endedAt: null,
        },
      ],
    };

    const report = generateReport(service);
    expect(report.totalPlannedSeconds).toBe(660);
    expect(report.totalActualSeconds).toBe(720);
    expect(report.overtimeSections).toEqual(["Sermon"]);
  });

  it("keeps only latest 30 reports", () => {
    const reports = Array.from({ length: 31 }, (_, index) => ({
      id: String(index),
      serviceName: "Service",
      serviceDate: "2026-05-07",
      createdAt: new Date(2026, 4, index + 1).toISOString(),
      sections: [],
      totalPlannedSeconds: 0,
      totalActualSeconds: 0,
      overtimeSections: [],
      insights: [],
    }));

    expect(keepLatestReports(reports)).toHaveLength(30);
    expect(keepLatestReports(reports).some((report) => report.id === "0")).toBe(false);
  });
});

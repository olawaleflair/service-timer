import type { ActiveService, ServiceReport } from "../types";
import { createId } from "./ids";
import { formatDuration } from "./time";
import { elapsedForSection } from "./timer";

export function generateReport(service: ActiveService, now = Date.now()): ServiceReport {
  const usedSections = service.sections.filter((section) => section.status !== "pending");
  const reportSections = usedSections.map((section) => {
    const actualSeconds = elapsedForSection(section, now);
    const varianceSeconds = actualSeconds - section.adjustedDurationSeconds;
    return {
      id: section.id,
      name: section.name,
      originalPlannedSeconds: section.originalDurationSeconds,
      addedSeconds: section.addedSeconds,
      reducedSeconds: section.reducedSeconds,
      finalAdjustedPlannedSeconds: section.adjustedDurationSeconds,
      actualSeconds,
      varianceSeconds,
      skipped: section.status === "skipped",
      startedAt: section.startedAt,
      endedAt: section.endedAt,
    };
  });

  const totalPlannedSeconds = reportSections.reduce(
    (total, section) => total + section.finalAdjustedPlannedSeconds,
    0,
  );
  const totalActualSeconds = reportSections.reduce((total, section) => total + section.actualSeconds, 0);
  const overtimeSections = reportSections
    .filter((section) => section.varianceSeconds > 0 && !section.skipped)
    .map((section) => section.name);

  return {
    id: createId("report"),
    serviceName: service.name,
    serviceDate: service.date,
    createdAt: new Date(now).toISOString(),
    sections: reportSections,
    totalPlannedSeconds,
    totalActualSeconds,
    overtimeSections,
    insights: buildInsights(reportSections, totalPlannedSeconds, totalActualSeconds),
  };
}

export function keepLatestReports(reports: ServiceReport[]): ServiceReport[] {
  return [...reports]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);
}

function buildInsights(
  sections: ServiceReport["sections"],
  totalPlannedSeconds: number,
  totalActualSeconds: number,
): string[] {
  const insights: string[] = [];
  for (const section of sections) {
    if (section.skipped) continue;
    if (section.varianceSeconds > 0) {
      insights.push(`${section.name} exceeded planned time by ${formatDuration(section.varianceSeconds)}.`);
    } else if (section.varianceSeconds < 0) {
      insights.push(`${section.name} ended ${formatDuration(Math.abs(section.varianceSeconds))} earlier than planned.`);
    }
  }

  const totalVariance = totalActualSeconds - totalPlannedSeconds;
  if (totalVariance > 0) {
    insights.unshift(`Total service exceeded planned time by ${formatDuration(totalVariance)}.`);
  } else if (totalVariance < 0) {
    insights.unshift(`Total service ended ${formatDuration(Math.abs(totalVariance))} earlier than planned.`);
  } else {
    insights.unshift("Total service matched the planned time.");
  }

  const biggestOvertime = [...sections]
    .filter((section) => section.varianceSeconds > 0)
    .sort((a, b) => b.varianceSeconds - a.varianceSeconds)[0];
  if (biggestOvertime) {
    insights.push(`${biggestOvertime.name} used the most overtime.`);
  }

  return insights.slice(0, 6);
}

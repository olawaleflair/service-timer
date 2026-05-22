import type { ActiveService, Section, StagePayload } from "../types";
import { formatTimer } from "./time";

export function applySectionTimeAdjustment(
  section: Section,
  mode: "add" | "reduce",
  seconds: number,
): Section {
  if (seconds <= 0) return section;

  if (mode === "add") {
    return {
      ...section,
      addedSeconds: section.addedSeconds + seconds,
      adjustedDurationSeconds: section.adjustedDurationSeconds + seconds,
    };
  }

  const reduction = Math.min(seconds, section.adjustedDurationSeconds);
  return {
    ...section,
    reducedSeconds: section.reducedSeconds + reduction,
    adjustedDurationSeconds: section.adjustedDurationSeconds - reduction,
  };
}

export function elapsedForSection(section: Section, now = Date.now()): number {
  if (section.status !== "running" || !section.startedAt) {
    return section.actualElapsedSeconds;
  }
  const started = new Date(section.startedAt).getTime();
  const delta = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  return section.actualElapsedSeconds + delta;
}

export function remainingForSection(section: Section, now = Date.now()): number {
  return section.adjustedDurationSeconds - elapsedForSection(section, now);
}

export function timerTone(remainingSeconds: number, warningThresholdSeconds: number): StagePayload["tone"] {
  if (remainingSeconds < 0) return "overtime";
  if (remainingSeconds <= warningThresholdSeconds) return "warning";
  return "normal";
}

export function currentSection(service: ActiveService | null): Section | null {
  if (!service?.currentSectionId) return null;
  return service.sections.find((section) => section.id === service.currentSectionId) ?? null;
}

export function nextSection(service: ActiveService | null): Section | null {
  if (!service?.currentSectionId) return null;
  const index = service.sections.findIndex((section) => section.id === service.currentSectionId);
  return service.sections.slice(index + 1).find((section) => section.status === "pending") ?? null;
}

export function stagePayloadFromService(service: ActiveService | null, now = Date.now()): StagePayload {
  if (!service) {
    return { mode: "blank", sectionName: "", timerText: "00:00:00", tone: "normal" };
  }
  if (service.stageDisplayHidden) {
    return { mode: "hidden", sectionName: "Stage output hidden", timerText: "", tone: "normal" };
  }
  const section = currentSection(service);
  if (!section) {
    return { mode: "blank", sectionName: "", timerText: "00:00:00", tone: "normal" };
  }
  const remaining = remainingForSection(section, now);
  return {
    mode: "timer",
    sectionName: section.name,
    timerText: formatTimer(remaining),
    tone: timerTone(remaining, service.warningThresholdSeconds),
  };
}

export function snapshotRunningService(service: ActiveService, now = Date.now()): ActiveService {
  return {
    ...service,
    updatedAt: new Date(now).toISOString(),
    sections: service.sections.map((section) => {
      if (section.status !== "running" || !section.startedAt) return section;
      return {
        ...section,
        actualElapsedSeconds: elapsedForSection(section, now),
        startedAt: new Date(now).toISOString(),
      };
    }),
  };
}

export function recoverServicePaused(service: ActiveService): ActiveService {
  return {
    ...service,
    status: "recoveredPaused",
    updatedAt: new Date().toISOString(),
    sections: service.sections.map((section) =>
      section.status === "running"
        ? { ...section, status: "paused", startedAt: null }
        : section.status === "paused"
          ? { ...section, startedAt: null }
          : section,
    ),
  };
}

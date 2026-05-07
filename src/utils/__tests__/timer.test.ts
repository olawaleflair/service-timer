import { describe, expect, it } from "vitest";
import type { Section } from "../../types";
import { elapsedForSection, remainingForSection, timerTone } from "../timer";

const baseSection: Section = {
  id: "s1",
  name: "Sermon",
  originalDurationSeconds: 600,
  adjustedDurationSeconds: 600,
  addedSeconds: 0,
  reducedSeconds: 0,
  actualElapsedSeconds: 120,
  status: "running",
  startedAt: "2026-05-07T00:00:00.000Z",
  endedAt: null,
};

describe("timer engine", () => {
  it("calculates elapsed time from timestamps while running", () => {
    const now = new Date("2026-05-07T00:01:30.000Z").getTime();
    expect(elapsedForSection(baseSection, now)).toBe(210);
    expect(remainingForSection(baseSection, now)).toBe(390);
  });

  it("uses persisted elapsed while paused", () => {
    expect(elapsedForSection({ ...baseSection, status: "paused", startedAt: null })).toBe(120);
  });

  it("assigns color tone from remaining time", () => {
    expect(timerTone(120, 60)).toBe("normal");
    expect(timerTone(60, 60)).toBe("warning");
    expect(timerTone(-1, 60)).toBe("overtime");
  });
});

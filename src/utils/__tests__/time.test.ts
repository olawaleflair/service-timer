import { describe, expect, it } from "vitest";
import {
  durationSegmentsToSeconds,
  formatTimer,
  normalizeDurationSegment,
  parseDuration,
  secondsToDurationSegments,
  validateDurationSegments,
} from "../time";

describe("time utilities", () => {
  it("parses HH:MM:SS durations", () => {
    expect(parseDuration("00:05:00")).toBe(300);
    expect(parseDuration("01:15:30")).toBe(4530);
    expect(parseDuration("1:00:00")).toBe(3600);
  });

  it("rejects invalid durations", () => {
    expect(parseDuration("5:00")).toBeNull();
    expect(parseDuration("00:99:00")).toBeNull();
    expect(parseDuration("sermon")).toBeNull();
  });

  it("formats overtime with a plus sign", () => {
    expect(formatTimer(300)).toBe("00:05:00");
    expect(formatTimer(-135)).toBe("+00:02:15");
  });

  it("normalizes and converts duration segments", () => {
    expect(normalizeDurationSegment("4")).toBe("04");
    expect(secondsToDurationSegments(5400)).toEqual({ hours: "01", minutes: "30", seconds: "00" });
    expect(durationSegmentsToSeconds({ hours: "02", minutes: "30", seconds: "00" })).toBe(9000);
    expect(durationSegmentsToSeconds({ hours: "00", minutes: "20", seconds: "05" })).toBe(1205);
  });

  it("rejects invalid minute and second segments", () => {
    expect(validateDurationSegments({ hours: "00", minutes: "65", seconds: "00" }).valid).toBe(false);
    expect(validateDurationSegments({ hours: "00", minutes: "20", seconds: "75" }).valid).toBe(false);
    expect(validateDurationSegments({ hours: "ab", minutes: "20", seconds: "00" }).valid).toBe(false);
  });
});

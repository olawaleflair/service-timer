import { describe, expect, it } from "vitest";
import type { Section } from "../../types";
import { reorderUpcomingSections } from "../queue";

function section(id: string, status: Section["status"] = "pending"): Section {
  return {
    id,
    name: id,
    originalDurationSeconds: 60,
    adjustedDurationSeconds: 60,
    addedSeconds: 0,
    reducedSeconds: 0,
    actualElapsedSeconds: 0,
    status,
    startedAt: null,
    endedAt: null,
  };
}

function ids(sections: Section[]) {
  return sections.map((item) => item.id);
}

describe("reorderUpcomingSections", () => {
  it("moves a pending section before the drop target", () => {
    const sections = [section("live", "running"), section("a"), section("b"), section("c")];

    expect(ids(reorderUpcomingSections(sections, "live", "b", "c"))).toEqual(["live", "a", "b", "c"]);
    expect(ids(reorderUpcomingSections(sections, "live", "c", "a"))).toEqual(["live", "c", "a", "b"]);
  });

  it("appends a pending section when dropped at the end", () => {
    const sections = [section("live", "running"), section("a"), section("b"), section("c")];

    expect(ids(reorderUpcomingSections(sections, "live", "a", "end"))).toEqual(["live", "b", "c", "a"]);
    expect(reorderUpcomingSections(sections, "live", "c", "end")).toBe(sections);
  });

  it("does not move the current or completed sections", () => {
    const sections = [section("done", "completed"), section("live", "running"), section("a"), section("b")];

    expect(reorderUpcomingSections(sections, "live", "done", "b")).toBe(sections);
    expect(reorderUpcomingSections(sections, "live", "live", "b")).toBe(sections);
  });
});

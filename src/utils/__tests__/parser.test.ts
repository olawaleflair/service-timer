import { describe, expect, it } from "vitest";
import { parseProgramText } from "../parser";

describe("parseProgramText", () => {
  it("parses forgiving comma-separated rows", () => {
    const rows = parseProgramText("Worship, 00:20:00\n Opening Prayer,00:05:00");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.valid)).toBe(true);
    expect(rows[0].durationSeconds).toBe(1200);
  });

  it("keeps invalid rows with row-level errors", () => {
    const rows = parseProgramText("Bad Row\nSermon, 00:45:00");
    expect(rows[0].valid).toBe(false);
    expect(rows[0].error).toBeTruthy();
    expect(rows[1].valid).toBe(true);
  });
});

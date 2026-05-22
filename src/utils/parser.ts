import type { ParsedProgramRow } from "../types";
import { createId } from "./ids";
import { parseDuration } from "./time";

export function parseProgramText(text: string): ParsedProgramRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const [namePart, ...durationParts] = raw.split(",");
      const name = namePart?.trim() ?? "";
      const durationInput = durationParts.join(",").trim();
      const durationSeconds = parseDuration(durationInput);

      if (!name) {
        return invalid(raw, "Section name is required.");
      }

      if (durationParts.length === 0 || durationSeconds === null || durationSeconds <= 0) {
        return invalid(raw, "Use: Section Name, HH:MM:SS");
      }

      return {
        id: createId("row"),
        raw,
        name,
        durationSeconds,
        valid: true,
      };
    });
}

function invalid(raw: string, error: string): ParsedProgramRow {
  return {
    id: createId("row"),
    raw,
    name: "",
    durationSeconds: 0,
    valid: false,
    error,
  };
}

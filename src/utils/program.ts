import type { Section, Template } from "../types";
import { createId } from "./ids";

export function createSection(name = "New Section", seconds = 300): Section {
  return {
    id: createId("section"),
    name,
    originalDurationSeconds: seconds,
    adjustedDurationSeconds: seconds,
    addedSeconds: 0,
    reducedSeconds: 0,
    actualElapsedSeconds: 0,
    status: "pending",
    startedAt: null,
    endedAt: null,
  };
}

export function sectionsFromTemplate(template: Template): Section[] {
  return template.sections.map((section) =>
    createSection(section.name, section.adjustedDurationSeconds || section.originalDurationSeconds),
  );
}

export function cloneSectionsForTemplate(sections: Section[]) {
  return sections.map((section) => ({
    id: createId("template_section"),
    name: section.name,
    originalDurationSeconds: section.originalDurationSeconds,
    adjustedDurationSeconds: section.adjustedDurationSeconds,
  }));
}

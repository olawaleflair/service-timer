import type { Section } from "../types";

/**
 * Reorders only pending sections after the current section. The target is
 * interpreted as the row the dragged section is dropped before, except for
 * "end", which appends it after the other movable sections.
 */
export function reorderUpcomingSections(
  sections: Section[],
  currentSectionId: string | null,
  sectionId: string,
  targetSectionId: string | "end",
): Section[] {
  const currentIndex = sections.findIndex((section) => section.id === currentSectionId);
  const sourceIndex = sections.findIndex((section) => section.id === sectionId);
  const source = sections[sourceIndex];
  if (!source || source.status !== "pending" || source.id === currentSectionId || (currentIndex >= 0 && sourceIndex <= currentIndex)) {
    return sections;
  }

  const movableSections = sections.filter(
    (section, index) => section.status === "pending" && (currentIndex < 0 || index > currentIndex),
  );
  const sourcePosition = movableSections.findIndex((section) => section.id === sectionId);
  const targetPosition = targetSectionId === "end"
    ? movableSections.length
    : movableSections.findIndex((section) => section.id === targetSectionId);
  if (
    sourcePosition < 0 ||
    targetPosition < 0 ||
    sourcePosition === targetPosition ||
    (targetSectionId === "end" && sourcePosition === movableSections.length - 1)
  ) return sections;

  const reordered = [...movableSections];
  const [moved] = reordered.splice(sourcePosition, 1);
  const insertionIndex = targetSectionId === "end"
    ? reordered.length
    : targetPosition > sourcePosition ? targetPosition - 1 : targetPosition;
  reordered.splice(insertionIndex, 0, moved);

  const movableIds = new Set(movableSections.map((section) => section.id));
  let cursor = 0;
  return sections.map((section) => (movableIds.has(section.id) ? reordered[cursor++] : section));
}

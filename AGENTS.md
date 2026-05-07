# Agent Instructions

Read `PROJECT_CONTEXT.md` before making code changes.

This project is a Tauri v2 desktop app for a church media team. It prioritizes reliability during live service over visual novelty or broad refactors.

## Working Rules

- Keep changes scoped and production-oriented.
- Do not introduce cloud services, login, analytics servers, or external internet dependencies for core app usage.
- Preserve offline-first behavior.
- Keep the stage display simple: current section name and timer only.
- Keep live-control actions predictable and confirmation-protected where risky.
- Do not edit the currently running section duration directly. Use Add Time / Reduce Time behavior.
- Prefer shared utilities for timer math and duration parsing.
- Keep Tauri v2 APIs and plugins compatible.
- Run checks before finishing:
  - `npm test`
  - `npm run build`
  - `cd src-tauri && cargo check`

## Important UX Constraints

- The control UI supports dark and light mode.
- The stage display must remain black, high contrast, and readable from a distance.
- Modal close buttons use icon buttons, not text.
- The live “Next section” action advances the service to the next program section.
- Starting blank must not prefill default sections.
- Prevent accidental close while an active service exists.

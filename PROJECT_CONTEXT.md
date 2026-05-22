# Service Timer Project Context

## Product

Service Timer is a Windows-oriented desktop app built with Tauri v2, React, TypeScript, Vite, and Rust.

It helps church media teams prepare a service program, assign durations to sections, run section timers during live service, show a clean stage timer on another display, and save a lightweight planned-versus-actual report.

The app is offline-first. Core service operation must not depend on internet access.

## Core User

The main user is a church media team member controlling timing during a live service.

The app should feel like a simple live production control tool:
- fast
- calm
- readable
- low cognitive load
- reliable under pressure

## Tech Stack

- Tauri v2
- Rust backend for native display/window coordination
- React
- TypeScript
- Vite
- Local persistence through Tauri Store with browser fallback
- No cloud database
- No login

## App Structure

Main frontend entry:
- `src/main.tsx`

Control app:
- `src/App.tsx`

Stage display:
- `src/StageWindow.tsx`

Tauri backend:
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json`

Shared types:
- `src/types.ts`

Persistence:
- `src/services/persistence.ts`

Tauri bridge:
- `src/services/tauri.ts`

Timer and report utilities:
- `src/utils/time.ts`
- `src/utils/timer.ts`
- `src/utils/reports.ts`
- `src/utils/parser.ts`

Reusable components:
- `src/components/DurationInput.tsx`

## State Model

The app keeps central state in `AppState`:

- `screen`
- `settings`
- `templates`
- `reports`
- `activeService`
- `stageDisplayStatus`
- `updateStatus`

`activeService` is the source of truth for an in-progress service.

Timer behavior should use timestamp-based calculations while running, not raw `setInterval` as truth. Intervals are for UI refresh and autosave snapshots.

## Active Service Rules

An active service may exist from setup through live operation.

If an active service exists:
- window close must be intercepted
- closing must show confirmation
- confirming close must end service, persist state, close stage display, then close the app
- cancelling close must leave the timer/service running

Recovery behavior:
- restored active service should be paused
- do not continue elapsed time based on wall clock while the app was closed

## Stage Display Rules

The stage display is intentionally dumb and minimal.

It must show only:
- current section name
- current timer

It must not show:
- controls
- next section
- settings
- reports
- notes
- branding

The stage display should remain black with high-contrast text regardless of control-window theme.

## Timer Rules

Display format is always `HH:MM:SS`.

Overtime uses a plus sign:
- `+00:02:15`

Timer colors:
- green for normal
- amber for warning threshold
- red for overtime

Manual move is the default. Auto move may exist through settings/service config.

## Duration Editing

Section durations use the reusable segmented `DurationInput`.

Expected behavior:
- fixed `HH:MM:SS` structure
- editable hours, minutes, seconds segments
- colons are not editable
- letters ignored/blocked
- minutes and seconds must be `0-59`
- single digits are padded on commit
- parent state receives seconds as a number

Do not reintroduce loose duration text inputs for program section editing.

## Service Setup Rules

Starting blank means truly blank:
- no Worship section
- no Sermon section
- no prefilled section list

Templates should still load saved sections.

The starting section selector must handle an empty section list.

## Modal Rules

All modal top-right close controls use a close icon button with accessible label:
- `aria-label="Close modal"`

Do not use visible text `Close` buttons in modal headers.

## Live Control Rules

The live control panel owns service control actions.

Important controls:
- Start section
- Pause
- Resume
- Restart
- Next section
- Add time
- Reduce time
- Hide/show stage display
- Reopen stage display
- End service

The forward action is user-facing copy `Next section`, not `Skip`.

Risky actions should be confirmation-protected:
- restart current section
- next section
- end service
- close app while service is active
- delete template

## Persistence

Core data is local:
- settings
- templates
- reports
- active service recovery snapshot

Keep report history to the latest 30 reports.

## Validation Commands

Run these before finishing meaningful changes:

```bash
npm test
npm run build
cd src-tauri && cargo check
```

For desktop runtime verification:

```bash
npm run tauri dev
```

## GitHub

Repository:
- `https://github.com/olawaleflair/service-timer`

Default branch:
- `main`

# Church Timer Pro

Church Timer Pro is the public name for the project currently branded **Service Timer** in the application and repository. It is an offline-first desktop timer for church media teams that need a calm, readable way to prepare and run a service program.

> **Release status:** The current application/configuration version is `2.0.0`, the major New UI release. This should not be read as a publicly published stable installer. Every successful push to GitHub `main` creates clearly labelled, unsigned production-candidate Actions artifacts using Tauri’s explicit `--no-sign` policy for maintainer testing. Strictly matched version tags create draft GitHub releases with the same temporary unsigned policy; installers remain test-only until signing/notarization is configured and the release is manually published.

[Repository](https://github.com/olawaleflair/service-timer) · [Releases](https://github.com/olawaleflair/service-timer/releases) · [Changelog](CHANGELOG.md) · [Security policy](SECURITY.md)

## What it does today

The current codebase provides:

- Service setup from a blank program or a saved local template.
- Program sections with `HH:MM:SS` durations, ordering, duplication, and deletion before a section is live.
- A live control panel with start, pause, resume, reset, previous/next section, and end-service actions.
- Add-time and reduce-time adjustments for the current section rather than direct duration editing while it is running.
- Warning, normal, and overtime timer states. Overtime is shown with a leading `+`.
- A separate stage-display window that shows only the current section name and timer. It can target another connected display, or open as a separate window on a single-display setup.
- Local templates, settings, report history, and active-service recovery data. Core use does not require an account, cloud database, or internet connection.
- Planned-versus-actual reports with section variance and service timing insights. The app keeps the latest 30 reports.
- Dark/light control-window themes. The stage display remains black with high-contrast text.

The app is designed for manual section changes by default. Automatic movement to the next section is available as a setting/service option.

## What is not complete yet

These items should be treated as planned or unfinished release work, not as current product promises:

- **Pasted program import:** the parser exists in the codebase, but the “Paste program text” entry point is currently disabled and marked “Coming soon” in the app.
- **Automatic updates:** the settings screen can check for updates, but the current native command reports that no update endpoint is configured. Updater artifacts are also disabled in the Tauri bundle configuration.
- **Sound alerts:** a sound-alert preference is present in settings, but a complete audible-alert workflow is not established in the current implementation.
- **Cloud sync, login, analytics, and report export:** these are not part of the current offline-first product.
- **Release support policy and signed installers:** the repository does not yet define a formal support window or a completed signing/notarization process.

## Downloading the app

When a release has been published, download installers from the [GitHub Releases page](https://github.com/olawaleflair/service-timer/releases), not from arbitrary build artifacts.

The current release workflow is configured to build:

- Windows MSI and NSIS installers.
- A macOS DMG.

The project context describes Windows as the primary orientation. Linux packaging is not configured in the current release workflow, so Linux should be considered unsupported unless a maintainer publishes separate guidance. Draft releases and staging artifacts are intended for testing before publication and are not end-user downloads.

## Branch and release flow

- Local `main` is the working branch. Push it only to the GitHub `staging` branch with `git push origin main:staging`; do not push local `main` to `origin/main`.
- GitHub `main` is the production branch. Promote changes only with a pull request from the repository’s `staging` branch to `main`.
- Pushes and pull requests involving `staging` run quality checks and create short-lived, clearly labelled test artifacts for macOS and Windows.
- Production quality checks run on `main`. Successful pushes to `main` also create unsigned, 14-day production-candidate Actions artifacts using Tauri `--no-sign`, named with the application version and commit SHA; the self-contained artifacts include checksum manifests whose paths are relative to the downloaded artifact root. These artifacts are for maintainer testing and do not create a GitHub Release or updater feed.
- A version tag must point to a commit reachable from `main` and match the versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
- Version-tag builds remain draft releases and use `--no-sign` until maintainers configure and verify signing/notarization; that flag must be deliberately removed or conditioned before signed publishing.
- The current release line is `2.0.0`, the major New UI release; follow-up maintenance releases continue as `2.0.x` patch versions.

See [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) for the maintainer release steps.

### First service

After opening the app:

1. Choose **Start New Service**.
2. Start with a blank program or choose a saved template. A blank program is genuinely empty; it does not add default sections.
3. Enter a service name and add at least one section. Set each duration in `HH:MM:SS` format and choose the starting section.
4. Optionally set the warning time, enable automatic movement, and select a stage-display screen.
5. Use **Stage Display Setup** and **Test selected display** when you want to verify the output screen.
6. Choose **Start Live Control**.
7. Use the live controls to start/pause/resume the current section, move between sections, or adjust the current section with add/reduce time.
8. Choose **End service** when the service is finished. A service with recorded activity produces a local planned-versus-actual report.

If the app is closed while a service is active, it asks for confirmation. A recovered active service is restored paused; elapsed time does not continue while the app was closed.

### Stage display

The stage window intentionally shows only the current section name and timer. On a multi-display setup, choose the target display before starting or from the live stage controls. With one display, the app opens the stage output in a separate window on that screen. If the selected display disconnects during a service, the app moves the stage output to the primary display when one is available.

### Live-control shortcuts

When focus is not inside an input, the live control panel supports:

| Key | Action |
| --- | --- |
| `Space` | Pause or resume |
| `←` / `→` | Previous or next section |
| `R` | Reset the current section |
| `+` / `-` | Add or reduce one minute |
| `H` | Hide or show the stage output |

Risky actions such as reset, moving to the next section, ending a service, and closing the app while a service is active use confirmation dialogs.

## Running the project locally

### Prerequisites

- Node.js and npm. Node.js 22 is the version used by the release workflow and is the recommended local version until the project declares an engines policy.
- Rust with the stable toolchain.
- The desktop development prerequisites required by [Tauri v2 for your operating system](https://v2.tauri.app/start/prerequisites/).

The repository does not currently include `.nvmrc`, `rust-toolchain`, or package `engines` fields, so the release workflow is the clearest source for the current Node/Rust baseline.

### Install and run

From the repository root:

```bash
npm ci
npm run tauri dev
```

The Tauri development command starts the Vite development server and launches the desktop application. A browser-only Vite session is also available with `npm run dev`, but native display/window behavior requires the Tauri app.

### Build and test

```bash
npm test
npm run build
cd src-tauri && cargo check
```

To create local Tauri bundles, run this from the repository root:

```bash
npm run tauri build
```

The current automated tests cover the parser, timer/time utilities, and report generation. They do not replace hands-on verification of the React control flow, native display coordination, persistence recovery, or close guard.

## Project layout

| Area | Location |
| --- | --- |
| React entry point | [`src/main.tsx`](src/main.tsx) |
| Control application | [`src/App.tsx`](src/App.tsx) |
| Stage display | [`src/StageWindow.tsx`](src/StageWindow.tsx) |
| Shared types | [`src/types.ts`](src/types.ts) |
| Local persistence | [`src/services/persistence.ts`](src/services/persistence.ts) |
| Tauri bridge | [`src/services/tauri.ts`](src/services/tauri.ts) |
| Timer/report/parser utilities | [`src/utils/`](src/utils/) |
| Native Tauri backend | [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs) |
| Tauri configuration and permissions | [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json) |
| Release workflow | [`.github/workflows/release.yml`](.github/workflows/release.yml) |

The application uses Tauri Store for desktop persistence and a browser `localStorage` fallback when running outside Tauri. There is no cloud backup or cross-device synchronization.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow, checks, and pull-request expectations. [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) contains maintainer-facing product and architecture context. [`AGENTS.md`](AGENTS.md) is repository-local automation guidance; it is not an end-user manual or a substitute for this public documentation.

## Security

Please read [`SECURITY.md`](SECURITY.md) before reporting a suspected vulnerability. Do not publish sensitive security details in a public issue.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

## Project decisions still open

The first public release still needs maintainers to complete the signed-release policy, update strategy, supported-version window, Code of Conduct, issue forms/templates, and the public security contact path. The current documentation intentionally describes those items as open rather than implying that a policy already exists.

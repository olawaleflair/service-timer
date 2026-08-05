# Contributing to Church Timer Pro

Thank you for helping improve Church Timer Pro, currently branded **Service Timer** in the app. Contributions should make the app more dependable for church media teams working under live-service pressure.

## Before you start

Read these project references first:

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) describes the product, state model, timer behavior, persistence, and important UX constraints.
- [`AGENTS.md`](AGENTS.md) contains repository-local instructions for automated coding agents. It is an internal engineering reference, not public user guidance.
- [`README.md`](README.md) contains the public product status and local setup instructions.

For a new feature or behavior change, first check whether the change fits the offline-first desktop scope. Avoid introducing login, cloud services, analytics servers, or internet access as a requirement for core service operation.

## Development setup

Use the recommended Node.js 22 baseline and Rust stable. Install the Tauri v2 desktop prerequisites for your operating system, then run:

```bash
npm ci
npm run tauri dev
```

The browser-only Vite server (`npm run dev`) is useful for frontend work, but native display and window behavior must be checked in the Tauri application.

## Make focused changes

Keep changes small and production-oriented. In particular:

- Preserve offline-first behavior and local persistence.
- Treat the active service as the source of truth while a service is in progress.
- Keep timer truth timestamp-based while running; use intervals only for refresh/snapshot work.
- Use the shared duration and timer utilities rather than duplicating parsing or timer math.
- Keep the stage display black, high contrast, and limited to the current section name and timer.
- Do not directly edit the duration of the currently running section; use add-time/reduce-time adjustments.
- Protect live or destructive actions with confirmation where the existing flow does so.
- Preserve blank setup as truly blank and keep the `Next section` user-facing action semantics.

## Tests and checks

Before opening a pull request, run the checks relevant to your change. For a normal code change, run all three:

```bash
npm test
npm run build
cd src-tauri && cargo check
```

If you change native window/display behavior, also run the desktop app and verify the behavior manually:

```bash
npm run tauri dev
```

The current automated suite focuses on parser, time/timer, and report utilities. Add or update tests for behavior that can be isolated from the desktop runtime. For UI, persistence, close-guard, and multi-display changes, include clear manual verification notes because those areas are not comprehensively covered by the current tests.

## Pull requests

A useful pull request should explain:

- What user or maintainer problem it solves.
- What behavior changed and what remains intentionally unchanged.
- How it was tested, including operating system and display setup when relevant.
- Any migration, persistence, release, or documentation implications.

Keep unrelated formatting or refactors out of a focused change. Update [`README.md`](README.md), [`CHANGELOG.md`](CHANGELOG.md), or other public documentation when a user-visible behavior or release expectation changes.

For live-control changes, describe the confirmation behavior and the effect on the active service. For stage-display changes, describe single-display and multi-display behavior. For persistence changes, describe recovery behavior and compatibility with existing local data.

## Issue reports

Until issue forms are added, please include:

- App version or commit.
- Operating system and whether the app was running as a packaged Tauri build or in development.
- Whether one or multiple displays were connected.
- Exact steps to reproduce the issue.
- Expected and actual behavior.
- Relevant logs or screenshots with private service information removed.

Do not include local persistence files, personal information, or sensitive security details in public issues.

## Branch and promotion policy

### Community contributions

The repository is public, but outside contributors do not push directly to this project. Instead:

1. Fork the repository from the public `main` branch.
2. Create a focused branch in your fork.
3. Open a pull request with **`staging`** as the target branch.

Do not open community pull requests directly into `main`. A maintainer reviews and merges accepted contributions into `staging` first, where the test-build workflow runs. Changes reach `main` only after staging validation.

### Maintainer promotion path

- Use local `main` as the working branch for maintainer changes.
- Push local `main` only to the GitHub `staging` branch: `git push origin main:staging`.
- Do not push local `main` to `origin/main`.
- GitHub `main` is production and receives changes only through a pull request from the repository’s `staging` branch.
- The `staging` workflow runs quality checks and creates short-lived Apple Silicon macOS, Intel macOS, and Windows test artifacts. These artifacts are for maintainer testing, not end-user distribution.
- The production workflow runs quality checks on `main`, then creates 14-day unsigned Apple Silicon macOS, Intel macOS, and Windows production-candidate Actions artifacts for each successful `main` push. Candidate and staging builds explicitly pass Tauri `--no-sign`; artifacts include the application version, commit SHA, and self-contained checksum manifests and are not public release installers.

## Releases

Production releases are driven by strict version tags matching `vMAJOR.MINOR.PATCH`. The tagged commit must be reachable from GitHub `main`, and the tag version must match `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. The workflow always creates draft Apple Silicon macOS, Intel macOS, and Windows releases for maintainer review with `--no-sign` until signing is deliberately configured; it does not publish installers automatically. Maintainers must manually verify, sign/notarize, and publish a draft release before treating it as an end-user release.

The current production line is `2.0.2`, following the major New UI release. Follow [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) for the version bump, promotion, tag, draft-release review, and later signing/publishing steps.

There is not yet a complete public release runbook, code-signing policy, or updater process. Keep release preparation and promotion notes in the pull request.

## Policies not added yet

This initial documentation set intentionally does not add a Code of Conduct or issue-template files. A proposed approach for maintainer review is:

1. Add a short, standard Code of Conduct with a clearly named maintainer contact and enforcement scope before opening broad community participation.
2. Add separate issue forms for bug reports, feature requests, and documentation improvements.
3. Keep security reports out of public issue forms and route them through the private disclosure path described in [`SECURITY.md`](SECURITY.md).

The project owners should decide the contact, enforcement responsibilities, and whether GitHub issue forms or plain templates best fit the project before those files are created.

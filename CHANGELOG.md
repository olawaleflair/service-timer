# Changelog

All notable changes to Church Timer Pro (currently branded Service Timer) will be documented here.

This changelog begins with the initial public documentation work. Earlier repository changes do not have a recorded user-facing release history, so historical entries are not reconstructed here.

## [Unreleased]

No changes yet.

## [2.0.0] — 2026-08-04

### Added

- A redesigned home dashboard with clearer access to new services, templates, reports, settings, and active-service recovery.
- A focused service-setup workspace and broadcast-style Live Console with a readable programme queue and planned-versus-actual timing context.
- Drag reordering for upcoming programme sections while completed and currently running sections remain fixed.
- Automated coverage for upcoming-section reordering and the settings migration used by this release.

### Changed

- Reworked the control-window interface across setup, templates, reports, settings, and live operation while preserving the simple black stage display.
- Changed the built-in warning threshold from five minutes to two minutes. Existing installations migrate the old built-in default once without overwriting a user-selected five-minute threshold.
- Updated every application version source to `2.0.0` for the major New UI release.

### Release status

- `v2.0.0` is built as an unsigned draft release for maintainer testing; it is not a publicly published stable release.
- macOS and Windows installers remain test-only until signing/notarization and manual release review are complete.

### Release preparation still open

- Publish and verify the first public installers.
- Complete the signing/notarization policy, supported-version window, and update strategy.
- Decide whether to add a Code of Conduct and GitHub issue forms/templates.

## [1.0.4] — previous production line

- The package, Cargo, lockfile, and Tauri configuration sources reported version `1.0.4` at the release tag.
- `v1.0.4` was published on 2026-08-03 with unsigned macOS DMG, Windows MSI, and Windows NSIS installers and is superseded by the `2.0.0` release line.
- No historical user-facing release notes are recorded for this version in the repository.

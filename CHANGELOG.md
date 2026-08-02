# Changelog

All notable changes to Church Timer Pro (currently branded Service Timer) will be documented here.

This changelog begins with the initial public documentation work. Earlier repository changes do not have a recorded user-facing release history, so historical entries are not reconstructed here.

## [Unreleased]

### Added

- MIT license with copyright holder `Olawale Omotoso`.
- Initial public README with download status, current capabilities, local development setup, and known limitations.
- Initial contribution, security, and changelog guidance.

### Changed

- Documented the local `main` to GitHub `staging` workflow and `staging` to production `main` promotion policy.
- Split staging test artifacts from draft production releases and added strict version-tag checks before release builds.
- Added unsigned, commit-labelled production-candidate Actions artifacts for successful GitHub `main` pushes, with bounded retention and checksums.
- Made the unsigned policy explicit with Tauri `--no-sign` for staging, main candidates, and draft tag builds until signing is deliberately enabled.
- Set the current production line to `1.0.4`; future patch releases continue from this line and the planned major redesign remains reserved for `2.0.0`.
- Kept production releases as drafts until signing and notarization are configured and manually verified.

### Release preparation still open

- Publish and verify the first public installers.
- Complete the signing/notarization policy, supported-version window, and update strategy.
- Decide whether to add a Code of Conduct and GitHub issue forms/templates.

## [1.0.4] — current production line

- The package, Cargo, lockfile, and Tauri configuration sources report version `1.0.4`.
- No stable public installer has been published for this version; matching `v1.0.4` must be created only after the version change reaches GitHub `main`.
- No historical user-facing release notes are recorded for this version in the repository.

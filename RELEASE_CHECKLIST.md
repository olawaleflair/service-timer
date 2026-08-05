# Release checklist

This checklist applies to Church Timer Pro, currently branded Service Timer. GitHub `main` is production; changes reach it only through the repository’s `staging` branch and promotion pull request.

## Every production change

- [ ] Confirm the promotion has reached GitHub `main` and production quality passes.
- [ ] Download the `PRODUCTION-CANDIDATE-<version>-<commit>-<platform>` Actions artifacts when installer testing is needed.
- [ ] Verify both expected macOS DMGs (Apple Silicon and Intel) and the Windows MSI/NSIS files plus the embedded SHA-256 manifest; run checksum verification from the downloaded artifact root.
- [ ] Confirm the candidate and staging workflows use Tauri `--no-sign` while signing is not deliberately configured.
- [ ] Treat these unsigned, 14-day artifacts as maintainer test material only. They do not create a GitHub Release or updater feed.

## Versioned draft release

- [ ] Choose the version that matches the change scope. `2.0.0` is the major New UI release; follow-up maintenance releases use `2.0.x` patch versions.
- [ ] Update `package.json`, both package-lock version fields, `src-tauri/Cargo.toml`, the `service-timer` entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
- [ ] Update `CHANGELOG.md` and relevant public release documentation.
- [ ] Run `npm test`, `npm run build`, and `cd src-tauri && cargo check`.
- [ ] Promote the change through GitHub `staging` and merge it into GitHub `main`.
- [ ] Only after the version change is on GitHub `main`, create the exact matching tag (for example, `v2.0.2`).
- [ ] Confirm CI verifies tag reachability, strict tag syntax, and every version source before building the draft release.
- [ ] Confirm the draft tag workflow still uses Tauri `--no-sign`; remove or condition that flag only as part of a reviewed signing change.
- [ ] Test the draft Apple Silicon macOS, Intel macOS, and Windows installers and review the generated release notes/assets.

## Before public publishing

- [ ] Configure and verify Windows code signing.
- [ ] Configure and verify Apple Developer ID signing and macOS notarization.
- [ ] Re-test clean installation and upgrade behavior on supported operating systems.
- [ ] Manually publish the draft only after signing/notarization and release review are complete.
- [ ] Keep updater artifacts disabled until a separate updater signing, endpoint, and key-retention policy is approved.

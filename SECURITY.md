# Security Policy

Church Timer Pro (currently branded Service Timer) is an offline-first desktop application for church media teams. Core service operation does not require a login, cloud database, or internet connection. The app does store settings, templates, reports, and active-service recovery data locally on the device.

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue, pull request, or discussion.

Use [GitHub’s private vulnerability reporting form](https://github.com/olawaleflair/service-timer/security/advisories/new) when it is available for this repository. If private reporting is unavailable, open a public issue requesting a private contact channel without including exploit details or sensitive data.

Include, where safe:

- A short description of the vulnerability and its potential impact.
- Affected app version or commit, operating system, and build type.
- Reproduction steps or a minimal proof of concept.
- Any required display, file, or local-environment conditions.
- Whether the issue involves local data exposure, the Tauri/native bridge, release artifacts, or another component.

Please give maintainers a reasonable opportunity to investigate before public disclosure. Do not attach service plans, report history, personal information, local store files, credentials, or other private material unless it is essential and the private channel is confirmed.

## Response expectations

The project does not yet have a formal security response SLA or supported-version window. Maintainers will acknowledge and assess reports as promptly as practical, coordinate fixes or mitigations, and document a release or advisory when appropriate.

Until a support policy is published, report against the latest published release or the current `main` commit and include the exact version/commit in the report. The repository currently contains version `1.0.4` in its package and Tauri configuration; that value is not by itself evidence that a stable release has been published.

## Release and dependency safety

Download installers only from a manually published release on the project’s [GitHub Releases page](https://github.com/olawaleflair/service-timer/releases). The production workflow intentionally keeps every version-tag release in draft status; Windows code signing and macOS signing/notarization must be configured and verified before maintainers publish one. Staging artifacts, production-candidate Actions artifacts, draft-release assets, and any unsigned installers are test material and must not be treated as verified end-user downloads.

The app’s core data path is local. There is no documented cloud backup or synchronization service. Local data locations are platform-specific; do not post their contents in public reports.

## Scope notes

The current codebase includes Tauri native window/display coordination, local persistence, a browser fallback for development, and a placeholder update-check command. Reports involving the update path, unexpected network access, unsafe native commands, data loss, or cross-window control should be treated as security-relevant and reported privately first.

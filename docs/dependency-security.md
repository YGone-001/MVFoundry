# Dependency Security Review

Date: 2026-10-31. Command: `npm audit --json` in a clean `npm ci` tree.

## Summary

`npm audit` reports **10 high-severity advisories, 0 critical, 0 moderate, 0 low**. All are transitive effects of a single advisory in `zod@4.5.4`:

- Advisory: GHSA-mrhx-c7xc-m3w5
- Title: Zod can exhaust memory while validating oversized constrained collections
- Affected range: `zod < 4.6.6`
- Installed: `zod@4.5.4`
- Patched: `zod@4.6.6+`

No direct dependency on Zod exists. Remotion 4.0.539 pins `zod` to exactly `4.5.4` in its Studio/server/media packages.

## Affected packages

| Package | Installed | Direct? | Path / exposure | Runtime, build or dev |
|---|---:|---|---|---|
| `@remotion/bundler` | 4.0.539 | yes | imports `@remotion/studio` → Zod | build/bundling (local) |
| `@remotion/cli` | 4.0.539 | yes | bundler/studio/codemods → Zod | development/studio |
| `@remotion/codemods` | 4.0.539 | no | via `@remotion/studio-protocol` | development |
| `@remotion/elevenlabs` | 4.0.539 | no | via `zod` | development/optional |
| `@remotion/media` | 4.0.539 | no | via `zod` | development/optional |
| `@remotion/openai-whisper` | 4.0.539 | no | via `zod` | development/optional |
| `@remotion/studio` | 4.0.539 | no | codemods/elevenlabs/media → Zod | development/studio |
| `@remotion/studio-protocol` | 4.0.539 | no | via `zod` | development/studio |
| `@remotion/studio-server` | 4.0.539 | no | bundler/codemods/protocol → Zod | development/studio |
| `zod` | 4.5.4 | no | validation library | build/studio tooling |

## Reachability

- The rendered video path uses `renderFrames` and local scene drawing; it does not accept untrusted Zod schemas.
- Remotion Studio/server tooling is local and not publicly exposed by MVFoundry.
- The affected code is build/development tooling, not a service that processes remote user input.
- The advisory remains real for a local attacker able to submit oversized constrained collections to Studio/server tooling; it is not classified as resolved.

## Remediation options

1. Upgrade Remotion to a release that depends on `zod >= 4.6.6` — **deferred**; requires a Remotion version change and a full compatibility test.
2. Override the pinned `zod` to 4.6.6+ — **not applied**; Remotion pins 4.5.4 exactly, so this is an unverified forced dependency change.
3. Downgrade `@remotion/cli` to a version suggested by the audit fix metadata — **not applied**; it changes the pinned Remotion toolchain and is not a validated security fix.
4. Remove Studio/CLI tooling from runtime dependencies — not sufficient or safe for the documented preview workflow.

Decision: **accept and track** the development/build-time advisory, do not suppress it, and do not force a dependency change. Revisit in a dedicated Remotion upgrade phase with full test evidence.

## P1-B dependency impact

External scene module loading introduces no new runtime or development dependencies. It uses the existing TypeScript compiler for static source analysis, the existing Remotion webpack bundler for the staged entry and the existing React/Remotion stack for rendering. The dependency entries in `package.json` and `package-lock.json` are unchanged by this feature; the advisory set above remains visible and unresolved.

## Verification

- No `npm audit fix` or `--force` was run.
- Dependency versions and lockfile remain the tested Remotion 4.0.539 set.
- CI does not hide the findings or run a forced fix; local triage is recorded here.

# Third-Party Notices

MVFoundry source does not vendor third-party source code or media. Dependencies are installed from npm using `package.json` and `package-lock.json`; each dependency remains subject to its own license.

## Major components

| Component | Use | License / terms |
|---|---|---|
| Remotion and `@remotion/*` packages | video framework, bundler, renderer, CLI | Remotion license; review https://remotion.pro/license. Free use is limited by Remotion's terms. |
| React / React DOM | composition UI runtime | MIT |
| TypeScript | build/type checking | Apache-2.0 |
| FFmpeg (system) | video/audio probing, synthetic media generation and video encoding | LGPL/GPL depending on the build; not bundled by this repository |
| CI FFmpeg build | transient Windows test tooling | BtbN FFmpeg-Builds, GPL shared build; downloaded into `RUNNER_TEMP` only for CI, not committed or redistributed |
| Remotion Skills (official) | optional agent guidance | Upstream content, installed separately; not vendored here |
| GitHub Actions (`actions/checkout`, `actions/setup-node`) | CI checkout and Node setup | Upstream actions; not vendored here; subject to their repository licenses |

## Transitive dependencies

The full transitive dependency set and resolved versions are recorded in `package-lock.json`. Their licenses are included in the installed packages or their upstream distributions. Users are responsible for reviewing the license obligations of the exact dependency tree they deploy.

## Synthetic fixtures

Synthetic audio is generated as a local sine tone. Synthetic images, transparent PNG layers and source videos are generated procedurally and encoded locally with FFmpeg. No third-party recording, artwork, lyrics or reference image is included.

The CI FFmpeg pin is documented in `docs/dependency-security.md`: release tag `autobuild-2026-10-30-13-01`, asset `ffmpeg-n9.0.2-39-g7adfbe40dc-win64-gpl-shared-9.0.zip`, SHA256 `7c09a4c6bd73a5013963f06b1c6175326605cbc2585444ebe0f740ef4f35b4c9`. It is used only transiently by the Windows runner and is not committed, redistributed or uploaded.

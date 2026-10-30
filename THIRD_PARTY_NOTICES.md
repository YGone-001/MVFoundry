# Third-Party Notices

MVFoundry source does not vendor third-party source code or media. Dependencies are installed from npm using `package.json` and `package-lock.json`; each dependency remains subject to its own license.

## Major components

| Component | Use | License / terms |
|---|---|---|
| Remotion and `@remotion/*` packages | video framework, bundler, renderer, CLI | Remotion license; review https://remotion.pro/license. Free use is limited by Remotion's terms. |
| React / React DOM | composition UI runtime | MIT |
| TypeScript | build/type checking | Apache-2.0 |
| FFmpeg (system) | video encoding and synthetic image fixture generation | LGPL/GPL depending on the build; not bundled by this repository |
| Remotion Skills (official) | optional agent guidance | Upstream content, installed separately; not vendored here |
| GitHub Actions (`actions/checkout`, `actions/setup-node`) | CI checkout and Node setup | Upstream actions; not vendored here; subject to their repository licenses |

## Transitive dependencies

The full transitive dependency set and resolved versions are recorded in `package-lock.json`. Their licenses are included in the installed packages or their upstream distributions. Users are responsible for reviewing the license obligations of the exact dependency tree they deploy.

## Synthetic fixtures

Synthetic audio is generated as a local sine tone. Synthetic images are generated procedurally. No third-party recording, artwork, lyrics or reference image is included.

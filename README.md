# MVFoundry

**AI Music Video Production Framework**

A local-first, agent-driven framework for building music videos with Remotion. It separates a reusable, song-independent engine from every song production, which lives outside this repository.

## 1. Project overview

MVFoundry provides:

- a validated per-project configuration contract;
- strict external-workspace isolation;
- integer output-frame timing with renderer-specific sampling;
- a typed scene registry and renderer adapters;
- local, hash-checked media resolution;
- a generic Remotion composition and local render scripts;
- agent Skills for direction, visual continuity, shot production, composition and acceptance.

It does not include any song, recording, lyrics, reference image, production scene or rendered video.

## 2. Implemented capabilities

- Project loading from `MV_WORKSPACE_ROOT` with schema and coverage validation.
- Canonical path checks: no repository fallback, traversal, absolute manifest paths, junction/symlink escapes or workspace overlap.
- Audio metadata for 16-bit PCM WAV, SHA256 and duration verification, and an explicit `round|floor|ceil` frame policy.
- Half-open integer frame ranges, binary-search shot resolution, and sampling after selection.
- Renderers:
  - `pixel-canvas` — configurable internal resolution, nearest-neighbour display, hold-based sampling.
  - `layered-canvas` — full-resolution Canvas 2D with an optional approved image background.
  - `video` and `hybrid` — typed fail-closed placeholders.
- Approved-asset staging into the external project cache and Remotion `publicDir`.
- Local rendering with Remotion `renderFrames` plus system FFmpeg.
- Two synthetic example projects, engine tests and publication audits.

## 3. Architecture overview

```
external workspace/project.json
  -> workspace guard -> config validator -> loader (hashes, duration)
  -> RenderProjectSnapshot
  -> Remotion MV-Factory -> frame-domain resolver -> scene registry
  -> pixel/layered renderer -> renderFrames -> system FFmpeg
  -> external project renders/
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/project-config.md](docs/project-config.md).

## 4. System requirements

- Node.js 20 or newer.
- npm with the committed lockfile.
- Google Chrome/Chromium, or `REMOTION_BROWSER_EXECUTABLE`/`CHROME_PATH` pointing to a browser. If unset, Remotion can manage its own headless browser.
- System FFmpeg on `PATH` for video encoding. Synthetic fixtures are generated with pure Node and do not require FFmpeg.
- Windows 10/11 x64. The engine and CI are currently maintained for Windows only.

## 5. Installation

```bash
npm ci
```

Official Remotion Skills are not vendored. Install them separately if your agent supports Skills:

```bash
npx -y skills@1.7.0 add remotion-dev/skills \
  --skill remotion-best-practices remotion-create remotion-docs remotion-markup \
          remotion-multimedia remotion-render remotion-studio --yes
```

The five project-owned Skills are already in `.agents/skills/`. See [docs/official-skills.md](docs/official-skills.md).

## 6. Running tests

```bash
npm run typecheck
npm test
```

`npm test` regenerates synthetic fixtures, compiles the engine and runs the test suite. Tests never require a private song or production asset, and they do not require FFmpeg.

CI runs the same checks on Windows with Node 20, including junction behavior, then runs the publication and Git media audits. See `.github/workflows/engine-ci.yml`. The dependency advisory review is in [docs/dependency-security.md](docs/dependency-security.md).

## 7. Creating a synthetic local project

The engine ships two synthetic profiles: a pixel-art 16:9/24fps project and a nonpixel 4:5/30fps layered project.

```bash
export MV_WORKSPACE_ROOT=/absolute/path/outside/this/repository
npm run seed:examples
```

On PowerShell: `$env:MV_WORKSPACE_ROOT = 'C:\absolute\path\outside\this\repository'`.

The seed command builds the engine, generates synthetic audio/image fixtures, validates the workspace boundary and creates the project folder skeleton.

## 8. Configuring MV_WORKSPACE_ROOT

- `MV_WORKSPACE_ROOT` is required for loading, seeding or rendering a project.
- It must exist, must be outside this repository, and must not contain this repository.
- Every project is a direct child whose folder name equals its `projectId`.
- Missing configuration fails closed; there is no repository fallback.
- Production audio, references, generated assets, caches and renders remain under the workspace.

## 9. Previewing and rendering

Preview the default synthetic composition:

```bash
npx remotion studio factory/src/entry.tsx
```

Render from an external project:

```bash
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-layered-demo --mode still --frame 10
```

Set `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` if Remotion cannot locate a browser. The render script writes frames, caches, reports and outputs only inside the external project's `cache/` and `renders/` directories.

`--out` is restricted to the project's `renders/` directory. A relative override must be a single filename (for example `--out take-01.mp4`); an absolute override must be a direct child of `renders/`. Traversal, other projects, the engine repository and linked destinations are rejected before staging or rendering. See [docs/workspace-safety.md](docs/workspace-safety.md).

## 10. External workspace safety policy

- Song-specific data never belongs in this repository.
- Workspace roots inside the repository are rejected.
- Manifest paths are relative and canonicalized; traversal and links that escape the project are rejected.
- Only approved, hash-verified assets are staged.
- All render/staging/cache writes go through a central write boundary tied to the canonical project root.
- Explicit output overrides are limited to direct children of the project `renders/` directory.
- Cache cleanup is limited to strict descendants of `<project>/cache`; linked entries and protected sources are never deleted.
- No public HTTP service is created for media.
- `.gitignore` is defense in depth; the workspace guard and write boundary are the primary protections.

## 11. Supported renderers versus planned renderers

| Renderer | Status |
|---|---|
| `pixel-canvas` | implemented |
| `layered-canvas` | implemented foundation |
| `video` | typed placeholder; fails closed |
| `hybrid` | typed placeholder; fails closed |

External project-local TypeScript scene loading is **not implemented**. P0 projects use declarative renderer parameters. A staged external-module loader is planned for a later phase and is not claimed here.

## 12. Third-party acknowledgments

- [Remotion](https://www.remotion.dev/) — video framework. Remotion has its own license terms; review https://remotion.pro/license before commercial use.
- [React](https://react.dev/) — MIT.
- [TypeScript](https://www.typescriptlang.org/) — Apache-2.0.
- [FFmpeg](https://ffmpeg.org/) — LGPL/GPL depending on the build; this repository does not bundle FFmpeg.
- [Remotion Skills](https://github.com/remotion-dev/skills) — installed separately, not vendored here.
- GitHub Actions standard actions (`actions/checkout`, `actions/setup-node`) — used only in CI, not vendored.

The synthetic fixtures are generated locally and contain no third-party media. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license and provenance notes.

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
  - `project:<id>` — trusted, hash-verified Canvas 2D scene modules declared by the external project.
- Approved-asset staging into the external project cache and Remotion `publicDir`.
- Per-project staged Remotion entries and local bundles that never copy project scene source into this repository.
- Local rendering with Remotion `renderFrames` plus system FFmpeg.
- Four synthetic example projects, engine tests and publication audits.

## 3. Architecture overview

```
external workspace/project.json + scenes/
  -> workspace guard -> config and scene-module validator -> loader (hashes, duration)
  -> RenderProjectSnapshot
  -> hash-verified module copies -> staged project entry under <project>/cache
  -> local Remotion bundle -> MV-Factory -> frame-domain resolver -> scene registry
  -> pixel/layered/project renderer -> renderFrames -> system FFmpeg
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

`npm run verify:modules` additionally requires a seeded external workspace and a usable browser; it bundles both module projects and renders real still evidence. CI runs the same checks on Windows with Node 20, including junction behavior, then runs the module bundle/still evidence, publication and Git media audits. See `.github/workflows/engine-ci.yml`. The dependency advisory review is in [docs/dependency-security.md](docs/dependency-security.md).

## 7. Creating a synthetic local project

The engine ships four synthetic profiles: two declarative projects and two project-local scene-module projects. They cover a pixel-art 16:9/24fps profile, a nonpixel 4:5/30fps layered profile, a low-resolution module project and a full-resolution TSX module project.

```bash
export MV_WORKSPACE_ROOT=/absolute/path/outside/this/repository
npm run seed:examples
```

On PowerShell: `$env:MV_WORKSPACE_ROOT = 'C:\absolute\path\outside\this\repository'`.

The seed command builds the engine, generates synthetic audio/image fixtures, validates the workspace boundary and creates the project folders, including `scenes/`.

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
npm run render:project -- --project synthetic-module-pixel-demo --mode video --frames 0-47
npm run render:project -- --project synthetic-module-layered-demo --mode still --frame 20
npm run verify:modules
```

Set `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` if Remotion cannot locate a browser. The render script writes frames, caches, reports and outputs only inside the external project's `cache/` and `renders/` directories.

`--out` is restricted to the project's `renders/` directory. A relative override must be a single filename (for example `--out take-01.mp4`); an absolute override must be a direct child of `renders/`. Traversal, other projects, the engine repository and linked destinations are rejected before staging or rendering. See [docs/workspace-safety.md](docs/workspace-safety.md).

## 10. External workspace safety policy

- Song-specific data never belongs in this repository.
- Workspace roots inside the repository are rejected.
- Manifest paths are relative and canonicalized; traversal and links that escape the project are rejected.
- Declared scene modules must stay under `scenes/`, be link-free and hash-verified before staging; unapproved, duplicate or cross-project modules fail closed.
- Only approved, hash-verified assets and trusted modules are staged.
- All engine-authored render, staging, cache and module-bundle writes go through a central write boundary tied to the canonical project root. The trusted Remotion/Webpack bundler writes its generated tree into a pre-validated empty cache directory.
- Explicit output overrides are limited to direct children of the project `renders/` directory.
- Cache cleanup is limited to strict descendants of `<project>/cache`; linked entries and protected sources are never deleted.
- No public HTTP service is created for media.
- `.gitignore` is defense in depth; the workspace guard and write boundary are the primary protections.

## 11. Supported renderers versus planned renderers

| Renderer | Status |
|---|---|
| `pixel-canvas` | implemented |
| `layered-canvas` | implemented foundation |
| `project:<id>` | implemented for trusted Canvas 2D scene modules |
| `video` | typed placeholder; fails closed |
| `hybrid` | typed placeholder; fails closed |

Project-local TypeScript/TSX modules are supported through an explicit manifest and a per-project staged Remotion entry. Modules are executable local code and are trusted only after explicit user approval and hash verification. See §12.

## 12. Project-local scene modules

A project can declare self-contained Canvas 2D modules under its own `scenes/` directory:

```json
"sceneModules": [
  {
    "id": "runner",
    "path": "scenes/runner.ts",
    "moduleType": "canvas2d",
    "contractVersion": 1,
    "sha256": "<64 lowercase hex characters>",
    "trust": "user-authored-approved",
    "canvas": {"mode": "project-pixel"},
    "samplingFps": "project-pixel",
    "pixelated": true
  }
]
```

A shot references the module as `"renderer": "project:runner"`. Optional `moduleParams` are JSON-safe primitives validated at runtime against the module's declared schema. The module exports:

```ts
const sceneModule = {
  id: 'runner',
  contractVersion: 1,
  moduleType: 'canvas2d',
  params: [{key: 'speed', type: 'number', required: true}],
  assetDependencies: [],
  render(ctx, context) {
    const tick = context.frame.animationTick; // frame-derived, deterministic
    // draw with ctx; read context.canvas, context.output, params, moduleParams and assets
  },
};
export default sceneModule;
```

The runtime context supplies the output frame, shot-local frame and time, output fps, renderer animation tick, the actual canvas size, project output metadata, shot identity, approved scene parameters, validated module parameters and approved asset references. Modules never receive a wall clock, timers or a mutable project object. A named `sceneModule` export is also accepted.

Approval and validation:

1. The path must be project-relative, reside under `scenes/`, end in `.ts` or `.tsx`, and contain no links or junctions.
2. The declared SHA256 is checked before staging. The verified bytes are copied into `<project>/cache/engine-bundle/modules/`; the original file is never modified.
3. `trust` must be exactly `user-authored-approved`. Missing, unapproved, duplicate or unknown-type modules fail closed.
4. A source policy rejects imports, re-exports, dynamic code, network APIs or URLs, DOM access, timers, clock reads, randomness and environment access. This is a rejection policy, not a sandbox.
5. A generated entry under `<project>/cache/engine-bundle/` imports only the staged copies and the engine through a controlled alias. It is bundled locally and never committed.
6. At bundle load, module identity, contract version, module type, parameter schema and asset dependencies are validated. Unknown parameters, missing assets or undeclared modules stop rendering.

A matching hash proves byte identity, not benign behavior. Only run user-authored or explicitly approved local scene code; there is no operating-system isolation, and the static policy cannot prove arbitrary TypeScript is safe. Importing the verified module executes its top-level code in the browser when the bundle loads, so approval must cover the whole module, not only its `render` function. Do not load scene code from the network, npm, GitHub or another project.

See `docs/project-config.md`, `docs/rendering.md` and `docs/workspace-safety.md` for the full contract, negative tests and remaining trust boundary.

## 13. Third-party acknowledgments

- [Remotion](https://www.remotion.dev/) — video framework. Remotion has its own license terms; review https://remotion.pro/license before commercial use.
- [React](https://react.dev/) — MIT.
- [TypeScript](https://www.typescriptlang.org/) — Apache-2.0.
- [FFmpeg](https://ffmpeg.org/) — LGPL/GPL depending on the build; this repository does not bundle FFmpeg.
- [Remotion Skills](https://github.com/remotion-dev/skills) — installed separately, not vendored here.
- GitHub Actions standard actions (`actions/checkout`, `actions/setup-node`) — used only in CI, not vendored.

The synthetic fixtures are generated locally and contain no third-party media. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license and provenance notes.

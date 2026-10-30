# Architecture — MVFoundry

## 1. System boundary

MVFoundry is the reusable engine. A production is a separate local project under `MV_WORKSPACE_ROOT` containing its own config, audio, lyrics, references, assets, scenes, caches, renders and reports. No production content is part of this repository.

## 2. Repository layout

```
factory/
  src/
    config/       types, validation, duration policy
    workspace/    workspace root and path isolation
    timeline/     frame clock, shot resolver, sampling
    scenes/       renderer contracts, registry, pixel/layered/placeholders
    media/        hashing, PCM WAV metadata, approved-asset staging
    project/      loader and browser-safe render snapshot
    remotion/     MV-Factory composition and default demo
    audit/        read-only Git audit
    entry.tsx     Remotion entry
  examples/       synthetic project configs (binaries generated, not committed)
  scripts/        fixture generation, workspace seed, render, Git audit
  tests/          engine tests
docs/             configuration, rendering, safety and Skills docs
security/         publication allowlist and audit
.agents/skills/   five project-owned universal Skills
```

## 3. Data flow

```
external project.json
  -> workspace guard
  -> config validator
  -> loader (audio WAV metadata/hash, asset hashes, shot coverage)
  -> RenderProjectSnapshot (no absolute paths)
  -> Remotion MV-Factory (dynamic dimensions/fps/duration)
  -> shot resolution on raw output frame
  -> renderer sampling
  -> SceneRegistry renderer
  -> renderFrames to project cache
  -> system FFmpeg to project renders/
```

## 4. Frame contract

- Canonical clock: integer output frames.
- Ranges: half-open `[startFrame, endFrame)`.
- Selection happens before renderer sampling.
- Sampling: `floor(localFrame * samplingFps / outputFps)` using integer arithmetic.
- 24fps output with 12fps sampling holds each drawing for two frames.
- A cut on an odd frame occurs on that exact frame.
- Cues carry explicit provenance: `measured`, `estimated` or `synthetic`.
- Audio is never retimed by visual sampling.

## 5. Project configuration

`project.json` defines identity, song metadata, audio path/hash/duration policy, lyrics/language, narrative mode, style profile, optional pixel profile, output size/fps, cues, chapters/shots, asset approvals, local-only permissions and render settings. Full rules are in `docs/project-config.md`.

Duration is derived from audio metadata with a declared `round|floor|ceil` policy. There are no global duration or scene-count constants.

## 6. Workspace safety

- `MV_WORKSPACE_ROOT` is mandatory; missing configuration is an error.
- The workspace must exist, be canonicalized and lie outside this repository; it must not contain this repository.
- Project IDs are pattern-restricted and equal the folder name.
- Project, audio and asset paths are canonicalized; absolute paths, `..`, junction/symlink escapes and paths inside the engine are rejected.
- Only approved, hash-verified assets are staged, into the project's own cache.
- No public HTTP service is created; only Remotion's local render server is used.

## 7. Media and rendering

- 16-bit PCM WAV metadata is read locally; SHA256 and duration are verified.
- Approved images/layers are copied to `cache/render-public` and served to Remotion as `publicDir`.
- Video is produced by `renderFrames` (lossless PNG) plus system FFmpeg, because Remotion's bundled FFmpeg may not be able to write outside the repository in restricted environments.
- Outputs: H.264, yuv420p, BT.709 tags, optional AAC audio.
- Renders, frames, caches and reports never enter Git.

## 8. Renderers

| Renderer | Status | Notes |
|---|---|---|
| `pixel-canvas` | implemented | configurable internal resolution; hold-based sampling |
| `layered-canvas` | implemented foundation | full-resolution Canvas 2D; approved image background |
| `video` | placeholder | typed; fails closed |
| `hybrid` | placeholder | typed; fails closed |

Renderers are registered in a typed registry. Adding a renderer does not change the frame clock. Unknown renderers fail at project load.

External project-local TypeScript scene modules are not loaded in P0. Projects use declarative renderer parameters. A future staged-entry loader must be implemented and tested before it is claimed.

## 9. Reproducibility

- No unseeded randomness or wall-clock time in drawing.
- Synthetic fixtures are generated deterministically by a committed script; binaries are ignored by Git.
- Tests cover configuration, workspace isolation, frame ownership, sampling isolation, multi-project loading, media staging, Git audit and provider absence.
- Render metadata must be verified with actual output, not source inference.

## 10. Known boundaries

- Video/hybrid renderers are placeholders.
- PCM WAV is the only audio probe implemented.
- System FFmpeg is required for video encoding.
- No external project TypeScript loader.
- No CI workflow is committed.
- Legal/license review of Remotion and FFmpeg usage remains the operator's responsibility.

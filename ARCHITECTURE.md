# Architecture — MVFoundry

## 1. System boundary

MVFoundry is the reusable engine. A production is a separate local project under `MV_WORKSPACE_ROOT` containing its own config, audio, lyrics, references, assets, scenes, caches, renders and reports. No production content is part of this repository.

## 2. Repository layout

```
factory/
  src/
    config/       types, validation, duration policy
    workspace/    workspace root, path isolation, central write boundary
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

## 7. Central write boundary

`factory/src/workspace/writeBoundary.ts` is the single validator for project writes and destructive cache operations:

- canonical project, cache and renders roots;
- writes only inside the project root, with cache/renders subtree restrictions;
- rejection of absolute escapes, traversal, engine-repository overlap and linked ancestors or destinations;
- validation of existing ancestor components and destinations that do not exist yet;
- render output restricted to direct children of `renders/`;
- cache recreation restricted to strict descendants of `cache/`, with a pre-deletion link scan;
- protection of source audio and approved asset files;
- fail-closed behavior if canonical validation cannot complete.

Race limitation: Node.js path-based filesystem APIs do not provide an atomic openat-style guarantee. A concurrent attacker able to mutate the filesystem between validation and write/delete could still race the boundary. The engine does not claim race-free protection against concurrent malicious mutation.

## 8. Media and rendering

- 16-bit PCM WAV metadata is read locally; SHA256 and duration are verified.
- Approved images/layers are copied to `cache/render-public` and served to Remotion as `publicDir`.
- Video is produced by `renderFrames` (lossless PNG) plus system FFmpeg, because Remotion's bundled FFmpeg may not be able to write outside the repository in restricted environments.
- Outputs: H.264, yuv420p, BT.709 tags, optional AAC audio.
- Renders, frames, caches and reports never enter Git.

## 9. Renderers

| Renderer | Status | Notes |
|---|---|---|
| `pixel-canvas` | implemented | configurable internal resolution; hold-based sampling |
| `layered-canvas` | implemented foundation | full-resolution Canvas 2D; approved image background |
| `video` | placeholder | typed; fails closed |
| `hybrid` | placeholder | typed; fails closed |

Renderers are registered in a typed registry. Adding a renderer does not change the frame clock. Unknown renderers fail at project load.

External project-local TypeScript scene modules are not loaded in P0. Projects use declarative renderer parameters. A future staged-entry loader must be implemented and tested before it is claimed.

## 10. Reproducibility and CI

- No unseeded randomness or wall-clock time in drawing.
- Synthetic fixtures are generated deterministically by a committed pure-Node script; binaries are ignored by Git and no FFmpeg is required for tests.
- Tests cover configuration, workspace isolation, write-boundary output restrictions, staging, cleanup, junction behavior, frame ownership, sampling isolation, multi-project loading, Git audit and provider absence.
- GitHub Actions validates Windows with Node 20, runs typecheck/tests, and runs the publication and Git media audits. No artifacts or production media are uploaded.
- Render metadata must be verified with actual output, not source inference.

## 11. Known boundaries

- Video/hybrid renderers are placeholders.
- PCM WAV is the only audio probe implemented.
- System FFmpeg is required for video encoding.
- No external project TypeScript loader.
- CI workflow exists in the working tree but has not been committed or executed remotely in this local-only phase.
- Write-boundary checks are path-based and cannot prevent concurrent filesystem races.
- The dependency tree carries 10 high npm advisories, all converging on `zod@4.5.4` pinned by Remotion; the risk is tracked in `docs/dependency-security.md` and is not represented as resolved.
- Legal/license review of Remotion and FFmpeg usage remains the operator's responsibility.

# Architecture — MVFoundry

## 1. System boundary

MVFoundry is the reusable engine. A production is a separate local project under `MV_WORKSPACE_ROOT` containing its own config, audio, lyrics, references, assets, scenes, caches, renders and reports. No production content is part of this repository.

## 2. Repository layout

```
factory/
  src/
    config/       types, validation, duration policy, scene-module manifest parsing
    workspace/    workspace root, path isolation, central write boundary
    timeline/     frame clock, shot resolver, sampling
    scenes/       renderer contracts, registry, pixel/layered/placeholders
      external/   project-local module contract, runtime binding and adapter
    media/        hashing, PCM WAV metadata, approved-asset staging
    project/      loader, browser-safe snapshot, module loading and staged entry
    remotion/     MV-Factory composition, default demo and local project bundling
    audit/        read-only Git audit
    entry.tsx     default Remotion entry
  examples/       synthetic project configs and scene modules (binaries generated, not committed)
  scripts/        fixture generation, workspace seed, render, module verification, Git audit
  tests/          engine tests
docs/             configuration, rendering, safety and Skills docs
security/         publication allowlist and audit
.agents/skills/   five project-owned universal Skills
```

## 3. Data flow

```
external project.json + scenes/
  -> workspace guard
  -> config validator (including scene-module manifest)
  -> loader (audio WAV metadata/hash, asset hashes, module paths/hashes/source policy, shot coverage)
  -> RenderProjectSnapshot (no absolute paths)
  -> staged verified module copies + generated entry under project cache
  -> local Remotion bundle with engine alias and project publicDir
  -> MV-Factory (dynamic dimensions/fps/duration)
  -> shot resolution on raw output frame
  -> renderer sampling
  -> SceneRegistry renderer (built-in or project:<id> adapter)
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

`project.json` defines identity, song metadata, audio path/hash/duration policy, lyrics/language, narrative mode, style profile, optional pixel profile, output size/fps, cues, chapters/shots, optional `sceneModules` and shot `moduleParams`, asset approvals, local-only permissions and render settings. Full rules are in `docs/project-config.md`.

Duration is derived from audio metadata with a declared `round|floor|ceil` policy. There are no global duration or scene-count constants.

## 6. Workspace safety

- `MV_WORKSPACE_ROOT` is mandatory; missing configuration is an error.
- The workspace must exist, be canonicalized and lie outside this repository; it must not contain this repository.
- Project IDs are pattern-restricted and equal the folder name.
- Project, audio and asset paths are canonicalized; absolute paths, `..`, junction/symlink escapes and paths inside the engine are rejected.
- Scene-module paths must be project-relative, under `scenes/`, free of links, inside the project after canonical resolution and hash-verified before staging.
- Only approved, hash-verified assets are staged, into the project's own cache.
- No public HTTP service is created; only Remotion's local render server is used.

## 7. Central write boundary

`factory/src/workspace/writeBoundary.ts` is the single validator for engine-authored project writes and destructive cache operations:

- canonical project, cache and renders roots;
- writes only inside the project root, with cache/renders subtree restrictions;
- rejection of absolute escapes, traversal, engine-repository overlap and linked ancestors or destinations;
- validation of existing ancestor components and destinations that do not exist yet;
- render output restricted to direct children of `renders/`;
- cache recreation restricted to strict descendants of `cache/`, with a pre-deletion link scan;
- protection of source audio, approved asset files and declared scene-module files;
- fail-closed behavior if canonical validation cannot complete.

The trusted Remotion/Webpack bundler writes its generated output tree directly into the pre-validated, freshly created `<project>/cache/engine-bundle/bundle` directory. Those individual bundler outputs are not passed through `assertSafePath`; project webpack configuration is never loaded. The generated entry and verified module copies are engine-authored and do pass through the boundary.

Race limitation: Node.js path-based filesystem APIs do not provide an atomic openat-style guarantee. A concurrent attacker able to mutate the filesystem between validation and write/delete could still race the boundary. The engine does not claim race-free protection against concurrent malicious mutation.

## 8. Media and rendering

- 16-bit PCM WAV metadata is read locally; SHA256 and duration are verified.
- Approved images/layers are copied to `cache/render-public` and served to Remotion as `publicDir`.
- Video is produced by `renderFrames` (lossless PNG) plus system FFmpeg, because Remotion's bundled FFmpeg may not be able to write outside the repository in restricted environments.
- Outputs: H.264, yuv420p, BT.709 tags, optional AAC audio.
- Renders, frames, caches and reports never enter Git.

## 9. Renderers and project scene modules

| Renderer | Status | Notes |
|---|---|---|
| `pixel-canvas` | implemented | configurable internal resolution; hold-based sampling |
| `layered-canvas` | implemented foundation | full-resolution Canvas 2D; approved image background |
| `project:<id>` | implemented | trusted project-local Canvas 2D module bound per bundle |
| `video` | placeholder | typed; fails closed |
| `hybrid` | placeholder | typed; fails closed |

Renderers are registered in a typed registry. Adding a renderer does not change the frame clock. Unknown renderers fail at project load.

A project may declare trusted Canvas 2D modules in `sceneModules`. The loader resolves each manifest path under the project's `scenes/` directory, rejects linked components and escapes, verifies the declared SHA256 and applies a static source policy before anything is bundled. It never imports or executes project modules in the Node host.

`stageProjectBundle` copies the verified bytes into `<project>/cache/engine-bundle/modules/` and writes a generated `entry.tsx` with explicit static imports. `bundleProject` enables a controlled `@mvfoundry` alias to the engine source, resolves dependencies from the engine `node_modules`, and writes the webpack output under `<project>/cache/engine-bundle/bundle/`. No project source enters the repository and no project can contribute a bundle to another project.

The generated entry calls `bindProjectSceneModules`, which validates the exported module identity, contract version, module type, parameter schema and declared asset dependencies, then creates `project:<id>` renderers in a bundle-local registry. Default built-in renderers remain available; module kinds are namespaced and cannot replace them. Functions stay inside the bundle and are never serialized through Remotion `inputProps`.

### Trust boundary

- The hash proves byte identity, not benign behavior. Importing the verified module executes its top-level code in the browser when the bundle loads; runtime identity checks happen after import.
- Only `user-authored-approved` local modules are eligible. Downloaded or remote code is never loaded.
- The static policy rejects imports, network APIs and URLs, dynamic code, DOM access, timers, clocks, randomness and environment access. It is not a sandbox and can be bypassed by sufficiently adversarial code.
- No operating-system sandbox or browser network interception is implemented. The render browser is a local trusted-code execution environment.
- Verified bytes are re-hashed immediately before bundling, but the external workspace is not locked against concurrent local mutation.
- Generated entry, module copies and bundles remain in the external project cache.

## 10. Reproducibility and CI

- No unseeded randomness or wall-clock time in drawing. Project modules are given frame-derived values only, and the source policy rejects common clock, timer and randomness APIs.
- Synthetic fixtures are generated deterministically by a committed pure-Node script; binaries are ignored by Git and no FFmpeg is required for tests.
- Tests cover configuration, workspace isolation, write-boundary output restrictions, staging, cleanup, junction behavior, frame ownership, sampling isolation, multi-project loading, module path/hash/trust/source rejection, runtime binding, staged entry isolation, Git audit and provider absence.
- `verify:modules` bundles both module projects and renders boundary/hold stills from the actual Remotion pipeline, writing evidence under each external project's `reports/` and `renders/`.
- GitHub Actions validates Windows with Node 20, runs typecheck/tests, seeds an external synthetic workspace, ensures a browser, runs module bundles and still renders, and runs the publication and Git media audits. A short video render runs when system FFmpeg is available; otherwise the workflow records NOT RUN rather than claiming a video result. No artifacts or production media are uploaded.
- Render metadata must be verified with actual output, not source inference.

## 11. Known boundaries

- Video/hybrid renderers are placeholders.
- PCM WAV is the only audio probe implemented.
- System FFmpeg is required for video encoding.
- Project scene modules currently support Canvas 2D only, must be self-contained (no imports) and expose a synchronous `render` function. Custom canvases are CSS-stretched to the output size; no automatic letterboxing is provided.
- Module asset dependencies are validated and passed as approved public paths; no asynchronous image-loading helper is provided.
- Scene-module validation combines path checks, SHA256 identity and a static source policy. It is not an OS sandbox or browser network sandbox; approved code is trusted code.
- CI workflow exists in the working tree but has not been executed remotely unless a publication was explicitly authorized and observed.
- Write-boundary checks are path-based and cannot prevent concurrent filesystem races.
- The dependency tree carries 10 high npm advisories, all converging on `zod@4.5.4` pinned by Remotion; the risk is tracked in `docs/dependency-security.md` and is not represented as resolved.
- Legal/license review of Remotion and FFmpeg usage remains the operator's responsibility.

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
    scenes/       renderer contracts, registry, pixel/layered/video/hybrid
      external/   project-local module contract, runtime binding and adapter
    media/        hashing, WAV/MP3/FLAC/M4A probing, normalization, video/PNG probes, timeline checks, staging
    audio/        deterministic multitrack PCM mixing, cue analysis, audio evidence measurement
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
external project.json + scenes/ + approved media
  -> workspace guard
  -> config validator (sceneModules, moduleParams, typed media, audio tracks)
  -> loader (audio format/decoded duration, asset hashes, FFprobe/PNG probes, module paths/hashes/source policy, media timelines, shot coverage)
  -> RenderProjectSnapshot (no absolute paths)
  -> audio: approved sources -> FFmpeg decode/normalize -> frame/sample alignment -> deterministic track mix
  -> one project-local PCM mix + mix report + cue analysis report
  -> staged verified module copies + generated entry under project cache
  -> local Remotion bundle with engine alias and project publicDir
  -> MV-Factory (dynamic dimensions/fps/duration)
  -> shot resolution on raw output frame
  -> Canvas path or shot-local React media Sequence
  -> renderFrames to project cache
  -> system FFmpeg mux from the PCM mix (or frame-range segment) to project renders/
```

## 4. Frame contract

- Canonical clock: integer output frames.
- Ranges: half-open `[startFrame, endFrame)`.
- Selection happens before renderer sampling.
- Sampling: `floor(localFrame * samplingFps / outputFps)` using integer arithmetic.
- 24fps output with 12fps sampling holds each drawing for two frames.
- A cut on an odd frame occurs on that exact frame.
- Cues carry explicit provenance: `measured`, `estimated` or `synthetic`.
- Audio maps to the same clock with `Math.round(frame * sampleRate / outputFps)` and half-open frame ranges. Non-integer ratios such as 44,100/24 are supported.
- The project mix sample count is `Math.round(durationInFrames * sampleRate / outputFps)`. Subranges slice from the corresponding global frame boundary.
- Audio is never retimed by visual sampling.

## 5. Project configuration

`project.json` defines identity, song metadata, the master audio path/hash/format/duration policy, optional mix rate/gain/fades/master automation, optional supplemental `audioTracks`, lyrics/language, narrative mode, style profile, optional pixel profile, output size/fps, cues, chapters/shots, optional `sceneModules`, shot `moduleParams`, optional typed `media` for video/hybrid shots, asset approvals, local-only permissions and render settings. Full rules are in `docs/project-config.md`.

Duration is derived from the master audio declaration with a declared `round|floor|ceil` policy. Decoded duration is verified against that declaration but does not redefine the policy. There are no global duration or scene-count constants.

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

## 8. Media, audio and rendering

- Master audio and approved `audio-reference` sources support 16-bit PCM WAV, MP3, FLAC and AAC-in-M4A. WAV uses the pure Node header path; other formats require FFprobe metadata plus an FFmpeg decode-duration pass. Format is detected by content.
- Master SHA256 and decoded duration are verified before rendering. `audio.assetId`, when declared, must match the master path and hash. Track source ranges are checked against decoded source duration.
- Approved sources are decoded to stereo signed 16-bit PCM at the project mix rate (44.1 or 48 kHz). Normalized copies, the mix WAV, mix report and analysis report stay under the external project cache/reports.
- The mixer applies frame-aligned source in-points, gain, linear fades and bounded linear dB automation, sums tracks, and applies one global deterministic limiter gain only when the summed peak exceeds 0.999. It reports peak before/after, limiter gain and clipping diagnostics; there is no automatic loudness normalization.
- The final MP4 muxes AAC exactly once from the project mix. For a nonzero frame subrange, the corresponding sample interval is sliced from the mix first. Embedded video audio remains muted.
- Preview uses the PCM mix through Remotion `<Audio>`; final output uses AAC encoding of that mix. Semantic consistency is claimed, not sample-identical playback.
- Deterministic analysis produces windowed RMS, peak and estimated onset candidates with source hash, algorithm version, parameters, frame and evidence metric. It is not tempo/section/lyric understanding and does not overwrite manual cues.
- 16-bit PCM WAV metadata is read locally; SHA256 and duration are verified.
- Approved assets are hash-verified and staged into `cache/render-public`.
- Video assets are probed with FFprobe: MP4/H.264, dimensions, constant frame rate, duration, audio presence and zero rotation. VFR, rotated, corrupt, unsupported or too-short sources fail closed.
- Layer assets are validated as 8-bit alpha PNGs via their IHDR before staging.
- Video sources are mapped to shot-local time with Remotion `Sequence` and `OffthreadVideo`'s composition-frame `trimBefore`; embedded audio is muted.
- Hybrid shots compose fallback background, video, ordered transparent PNG layers and a deterministic Canvas overlay.
- Video is produced by `renderFrames` (lossless PNG) plus system FFmpeg, because Remotion's bundled FFmpeg may not be able to write outside the repository in restricted environments.
- Outputs: H.264, yuv420p, BT.709 tags, exactly one AAC soundtrack from the authoritative mix.
- Renders, frames, caches, normalized audio, mixes, generated media fixtures and reports never enter Git.

## 9. Renderers and project scene modules

| Renderer | Status | Notes |
|---|---|---|
| `pixel-canvas` | implemented | configurable internal resolution; hold-based sampling |
| `layered-canvas` | implemented foundation | full-resolution Canvas 2D; approved image background |
| `project:<id>` | implemented | trusted project-local Canvas 2D module bound per bundle |
| `video` | implemented | approved local H.264 MP4; shot-local source in-point; muted source audio |
| `hybrid` | implemented | video + ordered transparent PNG layers + deterministic Canvas overlay |

Renderers are a discriminated union: Canvas renderers keep the existing `canvasSize`, `samplingFps` and `render(ctx, ...)` contract; media renderers expose a React `Component` rendered inside the composition. Existing custom Canvas renderers remain valid. Adding a renderer does not change the frame clock. Unknown renderers fail at project load.

Video/Hybrid shot selection occurs on the raw output frame. Media renderers use a shot-local Remotion `Sequence`; `trimBefore` is in composition frames and embedded audio is always muted. The authoritative project mix is the only audio stream.

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
- Base WAV/PNG fixtures are generated deterministically by a committed pure-Node script; binaries are ignored by Git and base tests do not require FFmpeg. Media probe/render tests and media fixtures require FFmpeg/FFprobe and are skipped or reported NOT RUN when unavailable.
- Tests cover configuration, workspace isolation, write-boundary output restrictions, staging, cleanup, junction behavior, frame ownership, sampling isolation, multi-project loading, module path/hash/trust/source rejection, runtime binding, staged entry isolation, media probe/timing/layer negatives, Git audit and provider absence.
- `verify:modules` bundles both module projects and renders boundary/hold stills from the actual Remotion pipeline, writing evidence under each external project's `reports/` and `renders/`.
- `media:seed` generates synthetic video/PNG/WAV media inside a disposable external workspace; `media:verify` renders media stills and complete videos, checks decoded source colors, cuts, PNG alpha, overlay motion, media metadata and soundtrack-only audio, and writes external reports.
- `audio:seed` generates synthetic WAV/MP3/FLAC/M4A sources and audio-project manifests in a disposable external workspace; `audio:verify` renders MP3-master, multitrack and 44.1 kHz boundary projects, then analyzes decoded output for format metadata, duration, onsets, gain, fades, ducking, track intervals, muted embedded video audio, nonzero subrange alignment and source-hash preservation.
- Unit tests cover audio frame/sample mapping, WAV parsing, format probing, normalization determinism, track validation, gain/fade/automation/limiter behavior, mix slicing, cue analysis, loader source-range checks and evidence measurement. FFmpeg-dependent tests skip only when the host lacks FFmpeg.
- GitHub Actions provisions the pinned FFmpeg/FFprobe build before typecheck/tests, verifies the required `libx264`, `libmp3lame`, `aac` and `flac` encoders, validates Windows with Node 20, seeds an external synthetic workspace, ensures a browser, runs module bundles and still renders, and runs media and audio seed/verify unconditionally plus publication and Git media audits. Provisioning/encoder failure or any verification failure fails the job; audio acceptance has no conditional-skip path. No artifacts or production media are uploaded.
- Render metadata must be verified with actual output, not source inference.

## 11. Known boundaries

- Video/Hybrid support approved local MP4/H.264 constant-frame-rate, zero-rotation sources only. VFR and rotated sources require preprocessing.
- `endBehavior` is `reject` only; freeze/hold/end-of-file policies are not implemented.
- Source in-points must align to output-frame boundaries. Source FPS may differ from output FPS, but exact source-frame selection is not claimed for unsupported VFR material.
- Embedded video audio is muted; the engine mix (master plus explicit tracks) is the only audio authority.
- Audio mixing supports gain, linear fades, explicit automation and manual ducking envelopes. It does not provide compression, EQ, reverb, automatic ducking, loudness targets or AI music understanding.
- MP3/FLAC/AAC ingestion depends on the local FFmpeg/FFprobe build and its decoders. Unsupported codecs, multichannel sources, unexpected streams and unsafe or ambiguous containers fail closed.
- Preview and final output use different playback encodings (PCM WAV vs AAC). Semantic alignment is verified; sample-identical preview/final playback is not claimed.
- Hybrid layers require 8-bit alpha PNGs and one built-in Canvas overlay; no arbitrary scene graph is provided.
- System FFmpeg and FFprobe are required for media fixture generation, audio decoding/mixing, video probing and encoding; FFmpeg is not bundled.
- Synthetic media and audio fixtures are generated externally and must not be committed.
- Project scene modules currently support Canvas 2D only, must be self-contained (no imports) and expose a synchronous `render` function. Custom canvases are CSS-stretched to the output size; no automatic letterboxing is provided.
- Module asset dependencies are validated and passed as approved public paths; no asynchronous image-loading helper is provided.
- Scene-module validation combines path checks, SHA256 identity and a static source policy. It is not an OS sandbox or browser network sandbox; approved code is trusted code.
- CI workflow exists in the working tree but has not been executed remotely unless a publication was explicitly authorized and observed.
- Write-boundary checks are path-based and cannot prevent concurrent filesystem races.
- The dependency tree carries 10 high npm advisories, all converging on `zod@4.5.4` pinned by Remotion; the risk is tracked in `docs/dependency-security.md` and is not represented as resolved.
- Legal/license review of Remotion and FFmpeg usage remains the operator's responsibility.

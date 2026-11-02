# Rendering

## Frame clock

- Output frame is an integer at the project's `fps`.
- Scene ranges are half-open `[startFrame, endFrame)`.
- The shot is selected from the raw output frame.
- Local frame = output frame minus shot start.
- Renderer sampling = `floor(localFrame * samplingFps / outputFps)`.
- For a 24fps project with 12fps pixel sampling, each drawing is held for two output frames.
- Sampling cannot move a cut or change soundtrack timing.

## Audio clock

- The integer output frame remains the editing clock. Audio maps through `Math.round(frame * sampleRate / outputFps)` with half-open frame ranges.
- 44,100/24 is supported: frame 25 maps to sample 45,938, and frames `[24, 41)` own 31,238 samples.
- The project mix contains `Math.round(durationInFrames * sampleRate / outputFps)` samples at the configured 44.1 or 48 kHz mix rate.
- A render subrange `[start, end]` muxes the mix interval `[start, end + 1)`. It never restarts the soundtrack from sample 0.
- Video and audio durations may differ by the sub-sample rounding remainder; the video frame count is unchanged.
- Fades and automation are declared in frames and applied in the sample domain.

## Project preview

```bash
npx remotion studio factory/src/entry.tsx
```

The default composition is a synthetic two-shot demo using built-in renderers. A project render validates and stages the project, generates a project-specific entry and bundles it locally. Media projects are previewed through the generated project entry during rendering; the static Studio default does not include external media.

## Project render

```bash
npm run build
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-module-pixel-demo --mode video --frames 0-47
npm run render:project -- --project synthetic-module-layered-demo --mode still --frame 20
npm run verify:modules
npm run media:seed
npm run media:verify
npm run render:project -- --project synthetic-video-demo --mode video --frames 0-47
npm run render:project -- --project synthetic-hybrid-demo --mode video --frames 0-44
npm run audio:seed
npm run audio:verify
npm run render:project -- --project synthetic-audio-mp3-demo --mode video --frames 0-47
npm run render:project -- --project synthetic-audio-multitrack-demo --mode video --frames 0-59
npm run render:project -- --project synthetic-audio-boundaries-demo --mode video --frames 24-40
```

Requirements:

- `MV_WORKSPACE_ROOT` points to an external workspace.
- The project is validated and its approved media is staged into the project cache.
- System FFmpeg and FFprobe are on `PATH` for audio decoding/mixing, video asset validation, media fixture generation and video encoding; stills without media or non-WAV audio do not need FFmpeg.
- Non-WAV masters/tracks require FFmpeg to probe, decode and normalize; a missing tool fails the load or mix explicitly.
- `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` can point to a browser; otherwise Remotion manages its own.

## Output override policy

- Default output is inside `<project>/renders/`.
- `--out` may be a single relative filename (for example `take-01.mp4`) or an absolute direct child of `renders/`.
- Nested relative paths, traversal, other projects, the engine repository, linked destinations and source audio/assets are rejected before staging or rendering.
- Rejected overrides produce no output file; tests cover both helper and real CLI behavior.

## Pipeline

0. Resolve the render browser before any staging, mixing, bundling or frame work. `checkRenderBrowser` calls Remotion's `ensureBrowser` with a download callback that always throws, so a host without a usable browser is refused with `BROWSER_READY`, `BROWSER_MISSING`, `BROWSER_EXECUTABLE_INVALID`, `BROWSER_VERSION_UNSUPPORTED` or `BROWSER_PROVISIONING_NOT_AUTHORIZED` and exit code 3. `REMOTION_BROWSER_EXECUTABLE` / `CHROME_PATH` select an installed browser; otherwise a browser that Remotion already manages is used. Nothing is downloaded implicitly. The chosen source and executable are recorded in the render report. A host that exports `NODE_TLS_REJECT_UNAUTHORIZED=0` produces a warning; the engine never sets or relies on that variable.
1. Load and validate the project, including `sceneModules`, `moduleParams`, typed `media` and `audioTracks`.
2. Verify the master audio format/decoded duration/hash, approved asset hashes, declared module hashes and FFprobe/PNG/audio metadata.
3. Reject unsupported, corrupt, unapproved, VFR/rotated video, non-alpha layer PNGs or unsupported/multichannel audio.
4. Apply the module source policy and refuse undeclared, unapproved, linked or mismatched modules.
5. Validate that each video source in-point plus shot duration fits the source under `reject`, and that track source ranges fit decoded audio.
6. Stage approved assets and audio into `cache/render-public`.
7. For video renders, decode/normalize every active audio source, build the single deterministic PCM mix, write it under `cache/audio-mix/`, and write the mix and analysis reports. Copy the mix into the staged public directory so preview `<Audio>` uses the same audio authority.
8. Copy verified module bytes into `cache/engine-bundle/modules/` and generate `cache/engine-bundle/entry.tsx` with explicit static imports.
9. Bundle that entry locally with the project's staged media as `publicDir`; the bundle output stays in `cache/engine-bundle/bundle/`.
10. Bind module exports into a bundle-local renderer registry; built-in renderers remain available and module IDs are namespaced.
11. Resolve each shot from the output frame. Canvas renderers draw with renderer-local sampling; Video/Hybrid renderers use shot-local React media Sequences.
12. Save lossless PNG frames to `cache/frames` copied into `cache/sequence`.
13. Slice the frame-range audio from the mix when rendering a subrange, then encode with system FFmpeg: H.264, configured pixel format, BT.709 tags, and exactly one AAC stream from that mix. Embedded video audio remains muted.
14. Write the output, render report, mix report, analysis report and metadata under the external project.

## Video and Hybrid rendering

Video and Hybrid are media renderers, not Canvas renderers. `FactoryFilm` selects the shot from the raw output frame and renders either the existing Canvas path or the media renderer's React component.

### Video

`VideoScene` wraps the shot in a Remotion `Sequence` and renders `OffthreadVideo` with:

- `trimBefore = sourceStartSeconds × outputFps`; Remotion 4.0.539 treats trim values in composition-frame units.
- `muted`, so embedded source audio never reaches the output.
- CSS `objectFit` from `fit`, plus deterministic translate/scale.

Frame 100 of a shot that starts at frame 100 displays its declared source in-point because the Sequence resets local time and `trimBefore` offsets the source. Source FPS may differ from output FPS; Remotion's decoder maps output time to the source. VFR and rotated sources are rejected before rendering.

`endBehavior` is `reject`: the loader and the component both check that the source has enough remaining duration. A too-short source stops the render instead of silently showing black frames.

### Hybrid

`HybridScene` composes in DOM order:

1. fallback background;
2. `OffthreadVideo` background with the same shot-local mapping and muted audio;
3. approved transparent PNG layers sorted by explicit `order`, with opacity, fit, position/scale and shot-local visibility ranges;
4. a deterministic Canvas overlay (`rain`, `orbits` or `scan`) drawn from local frames.

The overlay Canvas is independent of video readiness; Remotion handles image/video loading. A missing layer asset, unstaged source or invalid timing throws an actionable error rather than rendering a silent fallback.

### Media verification

```bash
npm run media:seed
npm run media:verify
```

`media:seed` generates synthetic 30fps/24fps H.264 MP4s with embedded 950 Hz audio, transparent RGBA PNG layers, WAV soundtracks and hash-approved manifests inside the external workspace. `media:verify` renders representative stills and complete videos for both media projects, samples decoded source colors at cut/in-point frames, checks PNG alpha and layer compositing, verifies H.264 dimensions/fps/frame counts, confirms one audio stream from the project mix, and checks embedded source audio is muted with FFmpeg band analysis. Reports are written externally to `reports/media-render-evidence.json`.

## Audio rendering

### Inputs and normalization

- The master keeps its declared `audio` path/hash/format/duration policy. Supplemental SFX, voiceover and ambience tracks are declared in `audioTracks`.
- WAV uses the pure Node PCM header; MP3, FLAC and AAC-in-M4A require FFprobe plus an FFmpeg decode-duration pass. Actual content is probed; extensions are ignored.
- Every active source is decoded to stereo signed 16-bit PCM at `audio.mixSampleRate` (44.1 or 48 kHz). Resampling and channel conversion are performed by FFmpeg; mixing is deterministic Node code.
- Normalized copies are written to `<project>/cache/audio-normalized/`; the authored source is never modified.

### Mix and mux

- Each track maps `startFrame`, `durationFrames` and `sourceStartSeconds` to a half-open sample interval. The master spans the whole project.
- Gain, linear fades and bounded linear dB automation are applied in the sample domain. Overlapping tracks are summed.
- If the summed peak exceeds `0.999`, one global deterministic gain is applied. The mix report records peak before/after, limiter gain, `wouldClipSamples` and `clippedSamples`; no whole-song loudness normalization is applied.
- The final mix is `<project>/cache/audio-mix/<projectId>-mix.wav`; the report is `<project>/reports/audio-mix-<projectId>.json`.
- The final MP4 muxes AAC exactly once from the mix. For a subrange `[start, end]`, the segment `[start, end + 1)` is sliced first and muxed instead.
- Video renders build the mix before preview; still renders do not produce an audio mix.
- Remotion `<Audio>` uses the same mix WAV for preview. Final output is AAC of that mix, so preview/final are semantically aligned but not sample-identical.
- Embedded video audio is always muted.

### Cue analysis

`reports/audio-analysis-<projectId>.json` contains deterministic RMS/peak envelopes, peak position and estimated onset candidates. Each event records the source hash, algorithm version, parameters, time/frame, `estimated` classification, `confidence: null` and an energy metric. It is not tempo/section/lyric analysis and never replaces manual cues.

### Audio verification

```bash
npm run audio:seed
npm run audio:verify
```

`audio:seed` generates a 24fps MP3-master project with a PCM reference, a 30fps FLAC + WAV SFX/voice + AAC/M4A ambience Hybrid project, and a 24fps 44.1 kHz click/boundary project. `audio:verify` renders them and analyzes the actual decoded output:

- FFprobe stream metadata and one audio stream;
- decoded output sample count against the frame-range boundary;
- MP3 burst timing versus the PCM reference;
- per-band gain for master/SFX/voice/ambience and silence outside track intervals;
- fades and the explicit 8 dB manual ducking envelope;
- muted 950 Hz embedded video audio;
- nonzero subrange offsets and odd-frame shot cut;
- estimated onset frames 6, 25 and 36 plus sample-domain boundaries;
- sample-level pulse evidence: the 44.1 kHz fixture’s 10 ms coarse window begins before a click, so the report distinguishes the window start from the physical 10%-peak leading edge (+0.317 ms) and the 12 ms pulse centroid (~+6 ms); this is measurement geometry, not timeline drift;
- source hash preservation.

Reports are written to each project's `reports/audio-render-evidence.json`. Skips are NOT RUN, never PASS.

## Project scene module rendering

The staged entry imports only the verified copies of declared modules and the engine source through a controlled `@mvfoundry` alias. The bundler resolves React, Remotion and other engine dependencies from the repository `node_modules`, but writes the entry, module copies, bundle and public copy under the external project's cache. A project cannot add, replace or share modules with another project's bundle.

At bundle load, `bindProjectSceneModules` checks:

- exported module ID, contract version, module type and render function against the manifest;
- parameter schema, required parameters and primitive types for each shot;
- declared asset dependencies against approved project assets and staged public paths.

A failed binding, unknown module, missing parameter or unstaged asset stops the render. The module never receives a wall clock or mutable project state, and functions are never passed through Remotion `inputProps`.

Module rendering evidence:

```bash
npm run verify:modules
```

This bundles both synthetic module projects and renders stills at hold boundaries, cuts and final frames. It checks composition metadata, PNG dimensions, module ownership, 12fps hold pairs, 30fps advancement, source audio/asset hashes and cache location, then writes `<project>/reports/module-render-evidence.json`. The command requires `MV_WORKSPACE_ROOT` seeded with the module examples and a usable Remotion browser.

## Outputs

- Video: external `renders/<projectId>-render.mp4`.
- Still: external `renders/<projectId>-still-<frame>.png`.
- Report: external `reports/render-<projectId>-<mode>.json`.
- Module evidence: external `reports/module-render-evidence.json` and `renders/evidence-*.png`.
- Media evidence: external `reports/media-render-evidence.json` and `renders/media-evidence-*.png`.
- Audio mix: external `reports/audio-mix-<projectId>.json` and `cache/audio-mix/<projectId>-mix.wav`.
- Audio analysis: external `reports/audio-analysis-<projectId>.json`.
- Audio evidence: external `reports/audio-render-evidence.json`.
- Normalized sources: external `cache/audio-normalized/`.
- Frames and temp data: external `cache/`.
- Generated entry, module copies and webpack bundle: external `cache/engine-bundle/`.
- Synthetic media/audio sources: generated only inside the external workspace; never committed.

No output is written into this repository. Cache recreation is restricted to strict descendants of `<project>/cache`; `render-public`, frames, sequences and temp are validated through the write boundary before any deletion. Node path APIs cannot eliminate concurrent filesystem races; see `docs/workspace-safety.md`.

## Why `renderFrames` plus system FFmpeg

In some restricted Windows environments Remotion's bundled FFmpeg cannot write outside the repository. The external workspace is mandatory, so video rendering uses Remotion to produce lossless frames and the system FFmpeg to encode inside the external workspace. The project config still controls pixel format and color space.

## Verification

Inspect actual output with ffprobe:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,color_space,color_primaries,color_transfer,nb_frames \
  -show_entries format=duration,size -of default=nw=1 <output.mp4>
```

Do not claim render success from source inspection alone.

For Video/Hybrid acceptance, `npm run media:verify` additionally checks:

- source color segments at the declared in-points and cut frames;
- PNG layer alpha and visible compositing;
- canvas overlay motion;
- one audio stream and muted embedded source audio using FFmpeg band analysis;
- source hashes before and after rendering.

For audio acceptance, `npm run audio:verify` decodes the actual output audio. Check:

- the container/stream count, sample rate and decoded sample count;
- burst/onset timing against synthetic expectations and the PCM reference;
- measured gain/fade/ducking levels and silence outside track intervals;
- nonzero subrange alignment and odd-frame cut behavior;
- master/track source hashes before and after rendering.

An MP4 containing an AAC stream is not, by itself, evidence of correct audio mixing. A skipped media/audio step is NOT RUN, never PASS.

## Preproduction storyboard preview

The preproduction layer writes a separate validated candidate config and never overwrites `project.json`. After an approved storyboard compiles:

```bash
npm run preproduction -- analyze-beats --project synthetic-beat-demo
npm run preproduction -- approve-beats --project synthetic-beat-demo \
  --interpretation as-estimated --acknowledge-ambiguity --notes "<review>"
npm run preproduction -- validate --project synthetic-beat-demo
npm run preproduction -- plan --project synthetic-beat-demo
npm run preproduction -- approve-plan --project synthetic-beat-demo
npm run preproduction -- storyboard --project synthetic-beat-demo
npm run preproduction -- approve-storyboard --project synthetic-beat-demo
npm run preproduction -- compile --project synthetic-beat-demo
npm run preproduction -- render-preview --project synthetic-beat-demo --frames 0-119
```

The preview loads `preproduction/project-candidate.json` through the normal loader, stages the same approved audio/assets, builds the master mix, and renders `renders/storyboard-preview.mp4`. The candidate chapters and shots are the actual shot selection used by `renderFrames`. Verify decoded output frame changes at storyboard cuts, the final audio stream, source hashes and a fresh beat analysis of the decoded soundtrack; JSON output alone is not preview evidence. `npm run preproduction:verify` performs these checks for the synthetic projects and reports external evidence.

A storyboard with missing assets returns a blocked compile and never produces a candidate or preview. The lyrics fixture is synthetic; real lyrics remain external and must never be committed.

## Complete production render

`factory/scripts/produce-mv.mjs` turns an approved storyboard into a full-length master. It composes the accepted services rather than replacing them:

```bash
npm run mv:seed
npm run preproduction -- analyze-beats --project synthetic-mv-signal-garden
npm run preproduction -- approve-beats --project synthetic-mv-signal-garden \
  --interpretation as-estimated --acknowledge-ambiguity --notes "<review>"
npm run preproduction -- plan --project synthetic-mv-signal-garden
npm run preproduction -- approve-plan --project synthetic-mv-signal-garden
npm run preproduction -- storyboard --project synthetic-mv-signal-garden
npm run preproduction -- approve-storyboard --project synthetic-mv-signal-garden
npm run mv:produce -- --project synthetic-mv-signal-garden
npm run mv:verify -- --project synthetic-mv-signal-garden
```

Order of operations: audio hash and decoded duration, asset staging and review, bound-hash verification, candidate compilation, full-range render, output inspection, project-local evidence.

### Full-duration practicalities

- `render-project.mjs` renders an inclusive frame range and muxes the sliced master mix. A 60-second master at 24 fps is 1440 frames, so the intermediate frame sequence is numbered with four digits (`frame-%04d.png`); a three-digit pattern silently stops at frame 999.
- The production job keeps the whole range in one invocation so the audio slice, the frame sequence and the encode stay aligned. There is no per-chunk concatenation step to get wrong.
- Output defaults to `renders/<projectId>-master.mp4`. The CI profile writes `renders/<projectId>-ci-master.mp4` from a candidate whose only change is the output resolution.

### Acceptance is inspection, not exit status

After FFmpeg exits, `produce-mv.mjs` re-probes the file and refuses to call it complete unless the codec, pixel format, dimensions, frame rate, frame count, single audio stream, audio codec and container duration all match the plan. `verify-mv-production.mjs` then decodes pixels and audio: shot boundaries must be visible cuts, motion inside a shot must be smaller than the smallest cut, Video shots must decode to their source clip at the declared in-point, Hybrid shots must show a layer contribution, and the soundtrack must keep its section energy profile and rhythmic markers.

### Retry and recovery

`--retry N` re-runs the render on failure. A retry is safe because it only rebuilds engine-owned cache: the approved sources, the bound assets and `project.json` are never written by the producer. A failed local render consumes no pilot admission and no provider budget, and it never triggers a new generation job.

## Shot previews and render diagnostics

The mv:workflow preview-shot command renders only the selected half-open interval through render-project, including its authoritative PCM mix slice. It verifies actual decoded video and audio before recording preview evidence. Existing outputs are refused. See [operator workflow](operator-workflow.md).

The producer records bounded render-attempt diagnostics (exit, signal, stderr, failure category, output state and source-hash preservation). A failed attempt never writes fresh success evidence. A stale existing master requires an explicit rerender or a new output filename. Idempotency also checks the actual output hash and workflow content binding.

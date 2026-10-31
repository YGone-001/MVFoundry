# Rendering

## Frame clock

- Output frame is an integer at the project's `fps`.
- Scene ranges are half-open `[startFrame, endFrame)`.
- The shot is selected from the raw output frame.
- Local frame = output frame minus shot start.
- Renderer sampling = `floor(localFrame * samplingFps / outputFps)`.
- For a 24fps project with 12fps pixel sampling, each drawing is held for two output frames.
- Sampling cannot move a cut or change soundtrack timing.

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
```

Requirements:

- `MV_WORKSPACE_ROOT` points to an external workspace.
- The project is validated and its approved media is staged into the project cache.
- System FFmpeg and FFprobe are on `PATH` for video asset validation, media fixture generation and video encoding; stills without media do not need FFmpeg.
- `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` can point to a browser; otherwise Remotion manages its own.

## Output override policy

- Default output is inside `<project>/renders/`.
- `--out` may be a single relative filename (for example `take-01.mp4`) or an absolute direct child of `renders/`.
- Nested relative paths, traversal, other projects, the engine repository, linked destinations and source audio/assets are rejected before staging or rendering.
- Rejected overrides produce no output file; tests cover both helper and real CLI behavior.

## Pipeline

1. Load and validate the project, including `sceneModules`, `moduleParams` and typed `media`.
2. Verify the audio hash/duration, approved asset hashes, declared module hashes and FFprobe/PNG metadata.
3. Reject unsupported, corrupt, unapproved, VFR/rotated video or non-alpha layer PNGs.
4. Apply the module source policy and refuse undeclared, unapproved, linked or mismatched modules.
5. Validate that each video source in-point plus shot duration fits the source under `reject`.
6. Stage approved assets and audio into `cache/render-public`.
7. Copy verified module bytes into `cache/engine-bundle/modules/` and generate `cache/engine-bundle/entry.tsx` with explicit static imports.
8. Bundle that entry locally with the project's staged media as `publicDir`; the bundle output stays in `cache/engine-bundle/bundle/`.
9. Bind module exports into a bundle-local renderer registry; built-in renderers remain available and module IDs are namespaced.
10. Resolve each shot from the output frame. Canvas renderers draw with renderer-local sampling; Video/Hybrid renderers use shot-local React media Sequences.
11. Save lossless PNG frames to `cache/frames` copied into `cache/sequence`.
12. Encode with system FFmpeg: H.264, configured pixel format, BT.709 tags, optional AAC from the approved soundtrack.
13. Write the output, render report and metadata under the external project.

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

`media:seed` generates synthetic 30fps/24fps H.264 MP4s with embedded 950 Hz audio, transparent RGBA PNG layers, WAV soundtracks and hash-approved manifests inside the external workspace. `media:verify` renders representative stills and complete videos for both media projects, samples decoded source colors at cut/in-point frames, checks PNG alpha and layer compositing, verifies H.264 dimensions/fps/frame counts, confirms one soundtrack audio stream, and checks embedded source audio is muted with FFmpeg band analysis. Reports are written externally to `reports/media-render-evidence.json`.

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
- Frames and temp data: external `cache/`.
- Generated entry, module copies and webpack bundle: external `cache/engine-bundle/`.
- Synthetic media sources: generated only inside the external media workspace; never committed.

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

A skipped media/video step is NOT RUN, never PASS.

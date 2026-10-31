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

The default composition is a synthetic two-shot demo using built-in renderers. A project render validates and stages the project, generates a project-specific entry and bundles it locally.

## Project render

```bash
npm run build
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-module-pixel-demo --mode video --frames 0-47
npm run render:project -- --project synthetic-module-layered-demo --mode still --frame 20
npm run verify:modules
```

Requirements:

- `MV_WORKSPACE_ROOT` points to an external workspace.
- The project is validated and its approved media is staged into the project cache.
- System FFmpeg is on `PATH` for video encoding; stills do not need FFmpeg.
- `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` can point to a browser; otherwise Remotion manages its own.

## Output override policy

- Default output is inside `<project>/renders/`.
- `--out` may be a single relative filename (for example `take-01.mp4`) or an absolute direct child of `renders/`.
- Nested relative paths, traversal, other projects, the engine repository, linked destinations and source audio/assets are rejected before staging or rendering.
- Rejected overrides produce no output file; tests cover both helper and real CLI behavior.

## Pipeline

1. Load and validate the project, including `sceneModules` and `moduleParams`.
2. Verify the audio hash/duration, approved asset hashes and declared module hashes.
3. Apply the module source policy and refuse undeclared, unapproved, linked or mismatched modules.
4. Stage approved assets and audio into `cache/render-public`.
5. Copy verified module bytes into `cache/engine-bundle/modules/` and generate `cache/engine-bundle/entry.tsx` with explicit static imports.
6. Bundle that entry locally with the project's staged media as `publicDir`; the bundle output stays in `cache/engine-bundle/bundle/`.
7. Bind module exports into a bundle-local renderer registry; built-in renderers remain available and module IDs are namespaced.
8. Resolve each shot from the output frame and draw with the selected built-in or `project:<id>` renderer.
9. Save lossless PNG frames to `cache/frames` copied into `cache/sequence`.
10. Encode with system FFmpeg: H.264, configured pixel format, BT.709 tags, optional AAC from the approved soundtrack.
11. Write the output, render report and metadata under the external project.

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
- Frames and temp data: external `cache/`.
- Generated entry, module copies and webpack bundle: external `cache/engine-bundle/`.

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

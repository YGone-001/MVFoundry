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

The default composition is a synthetic two-shot demo. Real project renders pass a validated project snapshot as input props.

## Project render

```bash
npm run build
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-layered-demo --mode still --frame 10
```

Requirements:

- `MV_WORKSPACE_ROOT` points to an external workspace.
- The project is validated and its approved media is staged into the project cache.
- System FFmpeg is on `PATH`.
- `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` can point to a browser; otherwise Remotion manages its own.

## Pipeline

1. Load and validate the project.
2. Verify the audio hash/duration and approved asset hashes.
3. Stage approved assets and audio into `cache/render-public`.
4. Bundle the MV-Factory entry with that directory as `publicDir`.
5. Resolve each shot from the output frame and draw with the selected renderer.
6. Save lossless PNG frames to `cache/frames` copied into `cache/sequence`.
7. Encode with system FFmpeg: H.264, configured pixel format, BT.709 tags, optional AAC from the approved soundtrack.
8. Write the output, render report and metadata under the external project.

## Outputs

- Video: external `renders/<projectId>-render.mp4`.
- Still: external `renders/<projectId>-still-<frame>.png`.
- Report: external `reports/render-<projectId>-<mode>.json`.
- Frames and temp data: external `cache/`.

No output is written into this repository.

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

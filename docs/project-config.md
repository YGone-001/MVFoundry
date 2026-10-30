# Project Configuration Contract

Each local music-video project is a directory under `MV_WORKSPACE_ROOT`:

```
<MV_WORKSPACE_ROOT>/<projectId>/
  project.json
  source/audio/...
  source/lyrics/...
  source/rights/...
  analysis/
  writing/
  visual/
  assets/images/
  assets/video/
  assets/layers/
  scenes/
  cache/
  renders/
  reports/
```

The folder name must equal `projectId`. The loader reads only `project.json` and manifest-declared files.

## 1. Top-level schema

```json
{
  "schemaVersion": 1,
  "projectId": "synthetic-pixel-demo",
  "song": {"title": "...", "artist": "..."},
  "audio": {
    "path": "source/audio/tone.wav",
    "sha256": "64 lowercase hex chars",
    "durationSeconds": 2,
    "durationPolicy": "round",
    "format": "wav-pcm"
  },
  "lyrics": {"language": "none", "path": null},
  "narrative": {"mode": "abstract"},
  "visual": {
    "styleProfile": "pixel-art",
    "defaultRenderer": "pixel-canvas",
    "pixel": {"internalWidth": 480, "internalHeight": 270, "samplingFps": 12}
  },
  "output": {"width": 1920, "height": 1080, "fps": 24},
  "cues": [{"id": "CUE-01", "frame": 0, "timeSeconds": 0, "source": "synthetic", "label": "start"}],
  "chapters": [
    {
      "id": "CH-01",
      "title": "First chapter",
      "startFrame": 0,
      "endFrame": 24,
      "shots": [
        {
          "id": "SHOT-01",
          "startFrame": 0,
          "endFrame": 24,
          "renderer": "pixel-canvas",
          "params": {"background": "#0B1B2B", "accent": "#2EC4B6", "bars": 7, "motion": 2.5}
        }
      ]
    }
  ],
  "assets": [
    {
      "id": "BG-01",
      "kind": "image",
      "path": "assets/images/bg.png",
      "sha256": "64 lowercase hex chars",
      "source": "Local synthetic fixture",
      "rights": "Synthetic; no third-party rights",
      "approval": "approved"
    }
  ],
  "permissions": {"externalGeneration": false, "localOnly": true, "allowNetwork": false},
  "render": {"codec": "h264", "pixelFormat": "yuv420p", "colorSpace": "bt709", "imageFormat": "png"}
}
```

## 2. Field rules

| Area | Rule |
|---|---|
| `schemaVersion` | exactly `1` |
| `projectId` | lowercase letters/digits/hyphens, 3-64 chars, equals folder name |
| `audio.path` | project-relative, no absolute path, no `..` |
| `audio.sha256` | lowercase 64-char hash; verified at load |
| `audio.durationSeconds` | positive; for PCM WAV must match the header within 0.02 s |
| `audio.durationPolicy` | `round`, `floor` or `ceil` |
| `output.width/height/fps` | positive integers; fps <= 120 |
| `output.durationInFrames` | optional; if present must equal the audio-derived duration |
| `cues[].frame` | integer in `[0, duration]`; `timeSeconds` must agree within half a frame |
| `cues[].source` | `measured`, `estimated` or `synthetic` |
| chapter/shot frames | integers, `startFrame < endFrame`, chapters cover `[0, duration)` exactly, shots cover each chapter exactly |
| `renderer` | must be registered in the scene registry |
| `params.assetId` | must reference an existing `approved` asset |
| `visual.pixel` | required when any shot or the default renderer is `pixel-canvas`; internal aspect must match output |
| `permissions.externalGeneration` | must be `false` in P0 |
| `permissions.localOnly` | must be `true` |
| `permissions.allowNetwork` | must be `false` |
| `render` | P0 supports h264 / yuv420p / bt709 and png or jpeg frame capture |
| assets | unique id, kind, relative path, hash, source, rights, approval |

## 3. Duration policy

`durationInFrames = policy(audio.durationSeconds * output.fps)`

Examples:

| Audio | fps | Policy | Frames |
|---:|---:|---|---:|
| 2.0 | 24 | round | 48 |
| 1.5 | 30 | round | 45 |
| 1.49 | 24 | floor | 35 |
| 1.49 | 24 | ceil | 36 |

The policy is part of the project contract. The engine never assumes 4919 frames or 204.96 s.

## 4. Renderers and params

| Renderer | Canvas | Sampling | Params |
|---|---|---|---|
| `pixel-canvas` | `visual.pixel.internalWidth × internalHeight` | `visual.pixel.samplingFps` | `background`, `accent`, `secondary`, `bars`, `motion`, `label` |
| `layered-canvas` | output width × height | output fps | `background`, `accent`, `secondary`, `assetId`, `motion`, `label` |
| `video` | output | output fps | placeholder; throws |
| `hybrid` | output | output fps | placeholder; throws |

Project-specific code beyond these params is not loaded in P0. See `docs/factory-architecture.md` §9.

## 5. Assets and approval

- `approved`: hash-verified, staged to `cache/render-public`, usable.
- `pending`, `rejected`, `not_present`: never staged and never usable in a scene.
- Rights and source are mandatory strings; secrets and private paths must not appear.
- The soundtrack is separate from the asset list but is hash- and duration-verified.

## 6. Examples

- `factory/examples/projects/synthetic-pixel-demo/project.json` — 1920x1080, 24fps, 48 frames, 12fps pixel sampling, 2 shots.
- `factory/examples/projects/synthetic-layered-demo/project.json` — 1080x1350, 30fps, 45 frames, layered renderer, approved background image, 2 shots.

Copy them into `MV_WORKSPACE_ROOT` with `factory/scripts/seed-workspace.mjs`.

## 7. Adding a new project without engine changes

1. Create `MV_WORKSPACE_ROOT/<projectId>/` outside the repository.
2. Add `project.json`, approved audio and assets.
3. Choose existing renderers and params; write frame-domain chapters/shots.
4. Validate with the loader/tests, then render via `factory/scripts/render-project.mjs`.

No engine source edit is required for a new duration, fps, dimension, shot count or style profile supported by the registered renderers.

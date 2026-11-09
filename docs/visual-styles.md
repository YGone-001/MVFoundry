# Visual styles

P1-G-A separates three concepts that were previously conflated:

1. **Visual style** — the visual language: composition, materials, lighting, motion, typography and colour intent.
2. **Rendering backend** — the executable mechanism that produces frames (`canvas2d`, `video`, or a future reviewed `svg`/`html`/`three` adapter).
3. **Asset production** — how approved characters, backgrounds and footage are obtained (programmatic art, supplied stills, approved video, or an offline/approved generation route).

A style is never the same thing as a backend. All six prototype styles use Canvas 2D, but they produce structurally different images.

## Catalog

`factory/src/style/catalog.ts` is the single registry. Ids are validated; an unknown id fails project load.

| Style id | Visual language | Implemented backend | Compatible backends | Required assets |
|---|---|---|---|---|
| `cinematic-illustration-2p5d` | Painterly layered depth, practical light, restrained push-in | `canvas2d` | `canvas2d`, `svg`, `three`, `video` | programmatic layered canvas; optional painted sheets or approved plates |
| `anime-motion-comic` | Ink, cel colour, speed lines, impact frames, panel wipes | `canvas2d` | `canvas2d`, `svg` | programmatic comic art; optional manga sheets |
| `ink-watercolor` | Paper, wet wash, negative space, one vermilion accent | `canvas2d` | `canvas2d`, `svg` | programmatic ink wash; optional scanned paper/brush textures |
| `editorial-motion-graphics` | Grid, bold type, duotone cutouts, hard graphic wipes | `canvas2d` | `canvas2d`, `html`, `svg` | programmatic type/cutouts; optional illustrated cutouts |
| `stylized-3d-diorama` | Isometric miniature stage, soft shadow, glossy floor, tilt-shift | `canvas2d` | `three`, `canvas2d` | programmatic isometric primitives; modelled props need real 3D |
| `retro-pixel` | Integer pixel grid, limited palette, dither, 12fps sampling | `canvas2d` | `canvas2d` | programmatic pixel art; optional sprite/tile sets |

Each profile also declares composition rules, materials, lighting, motion, camera, typography, output capabilities, limitations and quality expectations. A style is more than a palette.

## Themes

`factory/src/style/themes.ts` defines optional themes that own shared roles (`bg`, `ink`, `accent`, `paper`, `flash`, and so on). A theme can change the ground and accent of a title card, HUD or editorial layout. It cannot turn one style into another.

Implemented themes: `coral-noir`, `claude-light`, `aqua-morandi`, `amber-noir`.

Reference-only themes (`blueprint-stone`, `graphite-signal`, `celadon-paper`, `crimson-theater`) are documented but deliberately unregistered; entering one fails validation.

## Project configuration

Legacy projects keep `visual.styleProfile` and are never reinterpreted. A new project may additionally select a registered style:

```json
"visual": {
  "styleProfile": "cinematic-illustration-2p5d",
  "defaultRenderer": "project:style-gallery",
  "style": {
    "id": "cinematic-illustration-2p5d",
    "theme": "coral-noir",
    "note": "optional reviewer note"
  }
}
```

Rules:

- `visual.style.id` must be a registered style with an implemented backend.
- `visual.style.theme` is optional and must be registered.
- `style` is optional. Its absence preserves legacy behaviour.
- When `style` is present, every shot renderer must be either a declared project module whose `sceneModules[].styleIds` contains the selected style, or a media renderer listed in that style's `mediaRoutes`.
- Built-in renderers cannot silently claim a registered style. An unknown style, an undeclared media route or a capability the route does not declare fails closed.
- A module that omits `supportedStyles` is a legacy module; it cannot be selected by a style-driven project.

`sceneModules[].styleIds` is the project-level capability declaration. The module export declares the matching list:

```ts
const sceneModule = {
  id: 'style-gallery',
  contractVersion: 1,
  moduleType: 'canvas2d',
  supportedStyles: ['cinematic-illustration-2p5d', 'retro-pixel'],
  params: [],
  render: (ctx, context) => {
    // context.style is the validated active selection, or null for legacy modules.
    if (context.style?.id === 'retro-pixel') drawPixel(ctx, context);
    else drawCinematic(ctx, context);
  },
};
```

The project manifest and the module export must agree. A mismatch, an unregistered style, a duplicate style or an unknown strength/theme fails closed at load or bundle bind.

## Runtime context

A project module receives:

```ts
context.style = {
  id, label,
  theme: {id, label, mode, roles} | null,
  profile: frozen VisualStyleProfile
} | null
```

`null` means the project did not select a style (legacy path). The engine does not invent a default style, and a module cannot mutate the frozen profile.

## Backend capability status

`STYLE_BACKEND_CAPABILITIES` is the honest list:

- `canvas2d` — implemented. Full-resolution output (`canvas.mode: output`) or integer project pixels (`canvas.mode: project-pixel`).
- `video` — implemented for styles that declare a video media route. The renderer already existed; style binding is the new part.
- `hybrid` — implemented for styles that declare a hybrid media route.
- `parallax-2p5d` — implemented. Asset-backed layered 2.5D composition with deterministic camera, depth, atmosphere and optional comic treatment. It is layered cardboard parallax, not volumetric 3D.
- `svg` — `BLOCKED_CAPABILITY`: no reviewed SVG contract or sanitizer; project SVG would bypass the canvas-only trust boundary.
- `html` — `BLOCKED_CAPABILITY`: no trusted HTML composition adapter; project DOM would gain layout, font and event access outside the module contract.
- `three` — `BLOCKED_CAPABILITY`: no WebGL renderer, no reviewed GPU determinism policy, no headless SwiftShader acceptance. The diorama demonstration is an isometric Canvas 2D simulation, not real 3D.

These statuses are documentation, not configuration. Do not select `svg`, `html` or `three` for a production until a reviewed adapter exists.

## Media routes

Each style declares the media renderers it is actually reviewed for:

| Style | `parallax-2p5d` | `video` | `hybrid` | Notes |
|---|---|---|---|---|
| `cinematic-illustration-2p5d` | yes | yes | yes | image and video plates |
| `anime-motion-comic` | yes | yes | yes | comic treatment is declared |
| `ink-watercolor` | yes | yes | yes | image plates only for the 2.5D route |
| `editorial-motion-graphics` | yes | yes | yes | image plates only for the 2.5D route |
| `stylized-3d-diorama` | no | yes | yes | no cutout route; the stage is one continuous isometric set |
| `retro-pixel` | no | no | no | footage would break the pixel grid |

`mediaRoutes[].capabilities` additionally gates `image-plate`, `video-plate` and `comic-treatment`, so a style cannot accept a plate type or a comic treatment it never declared.

## Footage-hybrid route

`footage-hybrid` remains a **production route**, not a visual style. It composes approved local video clips and transparent PNG layers through the existing `video` and `hybrid` renderers. A style-driven project may now bind those renderers directly, but only when the selected style declares the route. The media contract is unchanged: project-relative approved assets, SHA256 and FFprobe validation, MP4/H.264 CFR, zero rotation, muted source audio, `endBehavior: reject`, and no remote or cross-project media.

## Asset-backed 2.5D route

A style-driven project may use `parallax-2p5d` shots:

```json
"media": {
  "kind": "parallax-2p5d",
  "background": {"kind": "image", "assetId": "BG-STREET", "parallax": 0.05, "blur": 2.2},
  "layers": [
    {"assetId": "MG-PLATFORM", "role": "midground", "order": 10, "parallax": 0.3, "blur": 0.8},
    {"assetId": "SUBJ-WOMAN", "role": "subject", "order": 20, "parallax": 0.62},
    {"assetId": "FG-RAIL", "role": "foreground", "order": 30, "parallax": 0.95, "blur": 3.2}
  ],
  "camera": {"kind": "push-in", "fromX": 0, "fromY": 0, "fromZoom": 1, "toX": 0, "toY": 0, "toZoom": 1.07},
  "atmosphere": {"kind": "rain", "intensity": 0.7, "windX": -0.1},
  "light": {"amplitude": 0.1, "frequency": 0.5, "phase": 0.2}
}
```

Contracts:

- The background must be an approved `image` (opaque PNG) or `video` asset. Layers must be approved `layer` assets with an alpha-capable PNG. A plate kind cannot be used as a layer and a layer cannot replace the plate.
- At least one `midground` and one `foreground` layer are required, orders must increase with depth role, and the depth span must be at least 0.25.
- `parallax` ranges: midground `0.10-0.60`, subject `0.45-0.90`, foreground `0.80-1.00`, background `0-0.12`. Camera `x`/`y` stay within ±0.25 of frame size; layer translation stays within ±0.7 of frame width.
- `blur` is optional depth of field in output pixels, `0-16`.
- `comic` is optional and only valid when the style declares `comic-treatment`.
- Grading comes from the style's declared `gradeBias`; per-shot `grade` overrides are bounded and colours must be `#rrggbb`.
- The shot-local output frame is the only motion input. The same frame always produces the same image.
- A style may declare `characters` on a 2.5D shot: a `poses[]` track of approved `layer` assets that tile the shot-local clock exactly. `cut` swaps on one frame, `crossfade` blends 2–12 frames, and the artwork pivot stays pinned to the authored anchor so a pose change never makes the subject jump. Flipping one drawing is not a pose.
- Preproduction planning and storyboard compilation now accept `parallax-2p5d` media alongside Canvas, video and hybrid: a planned shot declares a background plate slot, one slot per depth layer, one slot per character pose, depth roles, camera, atmosphere and light. Planned light is limited to amplitude/frequency/phase; a `sweep` must be authored directly in `project.json`.

## Commands

```bash
npm run style -- list
npm run style -- inspect --id cinematic-illustration-2p5d
npm run style -- check --project <projectId> --workspace <external-workspace>
npm run style:verify
npm run style:media:verify
```

`style:verify` creates a disposable synthetic two-second project, renders the same module under `cinematic-illustration-2p5d` and `retro-pixel`, decodes raw pixels, verifies a structural difference, verifies deterministic repeat output, and verifies that an unknown style is refused without writing an output file.

`style:media:verify` creates a disposable synthetic project that mixes a styled Canvas shot, a Video shot, a Hybrid shot and a 2.5D shot. It measures the decoded displacement of three colour-coded depth stripes, checks that foreground moves more than subject and subject more than midground, decodes a short MP4 for codec/size/fps/frames/pixel format/audio streams, and proves unknown styles, unsupported combinations, unapproved media and missing depth tiers fail closed with no output.

## Local artistic prototypes

```bash
npm run style:art -- --workspace <external-workspace> --project <project> --set cinematic
npm run style:prototype:seed -- --workspace <external-workspace> --project <project> --set cinematic
npm run render:project -- --project <project> --mode video --frames 0-359
npm run style:review -- --workspace <external-workspace>
```

`style:art` renders original procedural plates through the local browser canvas. `style:prototype:seed` writes the 15-second four-shot project and an original synthetic score. `style:review` extracts real decoded frames, builds labeled contact sheets, records technical QC and writes the human review checklist. These outputs are external and are not part of CI.

The prototypes prove that the compositor and the style-aware media route work, and that two visual languages differ structurally. They do not establish artistic approval; the verdict remains `PENDING_HUMAN_REVIEW` until the creator reviews the clips.

## Reference study

The style/theme separation and contact-sheet review method were studied from `Moessif/code-video-showcase` (MIT). Its runtime, fixed 120 BPM audio model and 61-second showcase timeline were not vendored into MVFoundry. The catalog, module contract, validators and gallery artwork in this repository are original; no third-party source, media or texture is included.

## Gallery corrections

- Ink now uses a soft shadow-blur under-wash, offset tide edges, paper tooth and figure brush detail. It still does not simulate real pigment diffusion.
- The diorama now scales character geometry with the set instead of enlarging the stage around fixed-pixel actors. The close shot reads, but wide/medium retain miniature-scale acting and real 3D remains blocked.

## Compatibility and status

- Existing pixel-art and module fixtures remain unchanged; `visual.style` is absent for them.
- The style catalog does not change audio timing, the frame clock, asset hashes, write boundaries or module trust checks.
- The six-style gallery is external evidence under the configured workspace, not a CI artifact and not a production approval.
- Artistic quality, subject performance and asset sufficiency remain human review decisions. A valid render proves structure and stability, not taste.

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
- When `style` is present, `visual.defaultRenderer` and every shot renderer must be a declared project module whose `sceneModules[].styleIds` contains the selected style.
- Built-in renderers cannot silently claim a registered style.
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
- `video` — framework-available. This is the existing approved-video/hybrid renderer path, not a style.
- `svg` — `BLOCKED_CAPABILITY`: no reviewed SVG contract or sanitizer; project SVG would bypass the canvas-only trust boundary.
- `html` — `BLOCKED_CAPABILITY`: no trusted HTML composition adapter; project DOM would gain layout, font and event access outside the module contract.
- `three` — `BLOCKED_CAPABILITY`: no WebGL renderer, no reviewed GPU determinism policy, no headless SwiftShader acceptance. The diorama demonstration is an isometric Canvas 2D simulation, not real 3D.

These statuses are documentation, not configuration. Do not select `svg`, `html` or `three` for a production until a reviewed adapter exists.

## Footage-hybrid route

`footage-hybrid` is a **production route**, not a visual style. It composes approved local video clips and transparent PNG layers through the existing `video` and `hybrid` renderers. The supporting style owns grading, overlays and typography. Its constraints are the existing media contract: project-relative approved assets, SHA256 and FFprobe validation, MP4/H.264 CFR, zero rotation, muted source audio, `endBehavior: reject`, and no remote or cross-project media.

In the current prototype, a project that selects `visual.style` must use project Canvas modules for every shot. Binding a selected style to a Video/Hybrid shot is not implemented yet; the route remains available to projects that do not select `visual.style`. This limitation is deliberate and disclosed rather than faked.

## Commands

```bash
npm run style -- list
npm run style -- inspect --id cinematic-illustration-2p5d
npm run style -- check --project <projectId> --workspace <external-workspace>
npm run style:verify
```

`style:verify` creates a disposable synthetic two-second project, renders the same module under `cinematic-illustration-2p5d` and `retro-pixel`, decodes raw pixels, verifies a structural difference, verifies deterministic repeat output, and verifies that an unknown style is refused without writing an output file. It uses the real Remotion browser and does not replace a full production render.

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

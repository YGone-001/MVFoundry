# Music-Aware Preproduction

This document covers the local, song-independent preproduction workflow added in P1-E-A. It turns verified synthetic audio and explicit user creative intent into an editable director plan, a frame-accurate storyboard, an asset requirements manifest, and—when all required local assets are approved—a separately compiled candidate project that can be rendered.

It does **not** implement semantic music understanding, lyric transcription, provider calls, image/video generation, or real-song production.

## 1. Files in an external project

All preproduction files remain under the external project:

```
<project>/preproduction/
  annotations.json       manual BPM, beat anchors, cut cues, sections
  creative-brief.json    user-authored style-independent direction
  lyrics.json | lyrics.lrc
  beat-grid.json         generated beat candidates and evidence (always unapproved)
  approved-beat-grid.json one explicit reviewer selection from beat-grid.json
  director-plan.json     active plan
  storyboard.json        active storyboard
  asset-requirements.json
  project-candidate.json compiled only when render-ready
  compile-report.json
  missing-assets.json
  revisions/
    approved-beat-grid-rNNN.json
    director-plan-rNNN.json
    storyboard-rNNN.json
```

The engine repository contains only reusable code, templates and synthetic test specifications. Generated audio, plans, lyrics, mixes, previews and renders stay external.

## 2. Versioned beat grid

`npm run preproduction -- analyze-beats --project <id>` decodes the verified master and runs a deterministic constant-tempo analyzer:

- energy-flux onset envelope;
- autocorrelation over a configurable BPM range;
- ranked tempo candidates;
- phase/alignment selection;
- frame-aligned candidate beats;
- confidence, ambiguity flags and evidence metrics.

It distinguishes transients from candidate beats and never treats a candidate grid as approved timing. Half/double tempo ambiguity, offbeat activity, tempo-change suspicion and insufficient rhythmic evidence are explicit. Constant tempo is the only supported model; it does not claim meter, downbeats, sections or changing-tempo tracking.

The synthetic 120 BPM acceptance fixture uses an explicit verification tolerance of **one output frame (33.3 ms at 30 fps)** for candidate beat placement; the measured candidate BPM is 119.681 and detected candidate frames are within one frame of the synthetic reference grid. The estimated phase can sit a fraction of a frame before the physical attack because it comes from an energy window; approved manual anchors are used for the render-ready plan.

### Frame-zero detection boundary

An onset exactly at frame 0 is outside the analyzer's supported detection domain. The onset envelope is a first difference of windowed RMS, so:

- `flux[0]` is structurally `0` — the first analysis window has no predecessor;
- the first window (1024 samples ≈ 21.3 ms at 48 kHz) already contains the attack energy of a t=0 onset, so `flux[1]` stays small;
- measured on the two synthetic fixtures, the leading onset produces `flux[1] = 0.028` (`synthetic-beat-demo`) and `0.025` (`synthetic-beat-grid-demo`) against `0.193` / `0.180` for the first internal kick — about 14 % of a normal onset, below both the 0.05 onset threshold and the 0.25 strong-onset threshold;
- the phase search therefore prefers a nonzero offset (`90` hops = 0.48 s and `122` hops = 0.6507 s) and the beat loop never revisits frame 0.

This is reported, not papered over. When the measured grid extrapolates back onto frame 0 with no detected beat there, the report adds the limitation `frame-zero-onset-not-detected`, and the verifier asserts that frame 0 was never invented. Control evidence: the identical 120 BPM rhythm delayed by 0.2 s is detected completely, including its leading beat, which shows the gap is a boundary effect rather than a waveform defect.

The supported way to obtain a start anchor is an explicit approved annotation — `annotations.bpm`, a `beatAnchors` entry at frame 0, or a `cutCues` entry at frame 0, each with `approval: "approved"`. Approved manual timing then takes precedence over the grid, as it does in Project A.

### Beat accuracy metrics

Beat accuracy is reported as separate values, because the maximum error of matched beats alone does not prove recovery:

- **tempo error** in BPM against the synthetic ground truth;
- **beat timing error** in output frames and milliseconds for each matched beat (1 frame at 30 fps = 33.3 ms);
- **matched beat count** — detections within one frame of a ground-truth beat;
- **missed ground-truth beats**, listed with their frame and the nearest detection;
- **extra detected beats** that match no ground-truth beat;
- **phase ambiguity** — `halfTempo` / `doubleTempo` flags, the competing candidate rows, `offbeatOnsets`, `phase.offsetHops` and `evidence.intervalJitterFrames`.

### Beat-grid approval

`beat-grid.json` is always `status: "estimated"` with `approval: "unapproved"`, and every event stays `source: "estimated"`, `classification: "estimated"`. Nothing in the analyzer, the planner or the compiler promotes it. The only route from an estimate into director timing is an explicit review:

```bash
npm run preproduction -- beat-grid-candidates --project <id>
npm run preproduction -- approve-beats --project <id> --interpretation as-estimated \
  --acknowledge-ambiguity --notes "Selected 90 BPM over the competing 45 BPM reading."
```

`approve-beats` writes `preproduction/approved-beat-grid.json` (plus a copy under `revisions/`) as an `ApprovedBeatGrid` record that keeps both sides of the decision: the measured provenance (`algorithmVersion`, master `sourceSha256`, candidate BPM, confidence, quality, ambiguity flags, candidate beat frames and IDs) and the reviewer's selection (`bpm`, `interpretation`, `ambiguityAcknowledged`, `selectedBy: "user"`, `beatFrames`, `beatIds`, `reviewNotes`, `approvalRevision`).

Rules enforced by `validateApprovedBeatGrid` on every load:

- `status` must be `approved`; anything else fails closed;
- the record must reference the current `beat-grid.json` path, algorithm version and master audio hash;
- candidate BPM, confidence, quality, ambiguity flags and the full candidate beat frame/ID lists must still match the grid on disk, so re-analysis that changes the estimate invalidates the approval instead of silently reusing it;
- a grid with `insufficient` evidence or a suspected tempo change cannot be approved;
- when the grid flags a competing interpretation, `ambiguityAcknowledged` is required and the selected BPM must match the chosen interpretation;
- `selected.beatFrames` must be exactly the beats that the chosen interpretation measures — a reviewer cannot quietly insert or drop a beat;
- `half-tempo` is only selectable when a competing half-tempo candidate exists.

`plan` then resolves timing in this order: approved manual BPM/beat anchors/cut cues → the approved beat grid → fail closed with `No approved timing source`. Manual annotations always win, and a high confidence score by itself authorizes nothing.

## 3. Manual annotations

`annotations.json` supports:

- approved BPM;
- approved beat anchors;
- approved cut cues;
- half-open sections with labels such as `intro`, `verse`, `chorus`, `bridge`, `instrumental`, `outro`, or user-defined labels.

Every manual item carries `source: "user"` and an approval status. Approved manual timing takes precedence over estimated timing. Reanalysis writes only `beat-grid.json`; it never overwrites annotations or an approved plan.

Validation rejects overlapping/gapped sections when coverage is required, out-of-range frames, duplicate IDs, frame/time disagreements, unapproved entries used by planning, and unsorted beat/cut events.

## 4. Optional lyrics

Use either UTF-8 LRC or the documented structured JSON format.

LRC:

```lrc
[ti:Synthetic test]
[00:00.50]A signal wakes in the quiet wire
[00:01.50]I answer with a borrowed light
```

Structured JSON adds language and optional section references:

```json
{
  "schemaVersion": 1,
  "language": "en",
  "format": "json",
  "approval": "approved",
  "lines": [
    {"timeSeconds": 0.5, "text": "A signal wakes", "sectionId": "SEC-01"}
  ]
}
```

Validation enforces UTF-8, explicit timestamps, strictly increasing timing, project-duration bounds, frame mapping at the project fps, non-empty text, and optional references to approved sections. Instrumental projects work without a lyrics file. There is no transcription, web fetch or lyric inference.

## 5. Creative brief

`creative-brief.json` is user-authored and style-independent. It includes:

- concept and narrative mode;
- mood progression;
- visual style and aspect ratio;
- palette, characters and setting;
- continuity rules;
- pacing constraints (`preferredShotFrames`, `minShotFrames`, `maxShotFrames`, `allowBeatCuts`);
- camera language and transitions;
- approved references, excluded elements and production constraints;
- preferred renderers;
- required asset briefs;
- editable assumptions.

The aspect ratio must match the project output. Preferred renderers must be registered. Approved references must exist and be approved. No style, song, language, shot count, palette or ratio is a global default.

## 6. Director plan

`npm run preproduction -- plan --project <id>` combines:

- the loaded project config and master hash;
- approved annotations;
- estimated beat grid evidence when appropriate;
- optional lyrics;
- the creative brief;
- available registered renderers and approved assets.

Each shot contains purpose, visual description, renderer, camera/movement/color direction, references, timing rationale, timing source, cue/beat reference, asset requirements, continuity references, review status and explicit assumptions.

`timingSource` records where each shot boundary came from and is one of `manual-bpm`, `manual-beat`, `manual-cut`, `section`, `approved-beat-grid`, `project-cue`, `lyric`. There is no `estimated-beat` source: an unapproved transient cannot appear as a shot boundary. A shot claiming `approved-beat-grid` must carry a `cueId` that is present in the plan's recorded `approvedBeatGrid.selectedBeatIds`, which `validatePlan` enforces.

The plan also records its timing authority in `source`: `manualTimingUsed`, `beatGridUsed`, `approvedBeatGridUsed`, `beatConfidence` and, when a grid was used, a nested `approvedBeatGrid` block with the approved BPM, interpretation, confidence, quality, `approvalRevision`, the full `candidateBeatIds` and the `selectedBeatIds`. That makes the difference between *estimated audio event*, *reviewed beat candidate*, *approved timing decision* and *manual override* readable from the plan alone.

The plan is `proposed`, not active project config. Approved plans are never overwritten by reanalysis. Revisions are written under `preproduction/revisions/`; `--new-revision` creates a traceable revision without replacing an approved active plan. `approve-plan` is an explicit action.

## 7. Storyboard and assets

`storyboard` converts an approved plan into frame-accurate execution data:

- half-open chapters and shots covering the full project duration;
- unique IDs and no gaps/overlaps;
- project cue references, manual cut-cue references and lyric-line associations;
- explicit renderer and asset requirement references;
- per-shot missing-asset status and `rendererReady`;
- a global `renderReady` flag.

`report-assets` writes the manifest and returns exit code 2 while requirements are missing. Supported requirement kinds include image, video, transparent layer, Canvas scene module and existing asset. Statuses distinguish needed, in-production, available, approved and rejected. A requirement is not an asset; it becomes fulfilled only through an approved, verified local file or declared scene module.

`attach-asset` is the intake path for image, video and layer requirements. An `image` requirement accepts an ordinary 8-bit PNG — grayscale, RGB, grayscale-alpha or RGBA — so a plain opaque photograph is valid and its missing alpha is only reported; a `layer` requirement keeps the strict alpha rule (colour type 4 or 6) because the Hybrid renderer needs real transparency. The same opaque PNG that is accepted as an image must be refused as a layer, palette and 16-bit PNGs are refused rather than approximated, and JPEG intake is not implemented. Every attachment lands as `review: "pending"`: only `review-asset --decision approve` binds it, and `review-asset --decision reject` keeps the requirement unfulfilled.

A project created by `mv-project.mjs init` has `chapters: []`. Preproduction commands load it through the preproduction stage, which accepts an empty timeline; the render loader does not, so an unfinished project can never render and no placeholder shot is invented.

To fulfil a requirement, add the approved local asset/declared module to the project, edit the plan requirement to `status: "approved"` with the real `fulfilledAssetId`, regenerate the storyboard, approve the revised storyboard, and recompile. The engine does not invent an asset ID, download media, or generate an image/video.

### CLI and exit codes

```text
npm run preproduction -- analyze-beats --project <id>
npm run preproduction -- beat-grid-candidates --project <id>
npm run preproduction -- approve-beats --project <id> --interpretation <as-estimated|half-tempo> \
  --notes "<review>" [--acknowledge-ambiguity] [--new-revision]
npm run preproduction -- validate --project <id>
npm run preproduction -- plan --project <id> [--new-revision]
npm run preproduction -- approve-plan --project <id> [--revision N]
npm run preproduction -- storyboard --project <id> [--new-revision]
npm run preproduction -- approve-storyboard --project <id> [--revision N]
npm run preproduction -- report-assets --project <id>
npm run preproduction -- compile --project <id>
npm run preproduction -- render-preview --project <id> [--frames A-B]
```

All commands require `--workspace <external-root>` or `MV_WORKSPACE_ROOT`. Exit code 0 means the command completed; 1 means validation/execution failed; 2 means usage error or a deliberately blocked report (missing assets/compile). `--new-revision` writes a revision under `preproduction/revisions/` without replacing an approved active plan/storyboard, and for `approve-beats` it records a new approval revision while preserving the earlier approval file.

Approval here is a local, structured and re-validated record, not an authenticated identity. It proves that a review step existed and what it selected; it is not a signature and confers no authorization beyond this workspace.

## 8. Approved compilation

`compile` requires an approved storyboard with no missing asset requirements. It builds a separate `preproduction/project-candidate.json` validated by the existing project validator, preserving:

- project ID, master audio/hash and duration authority;
- output fps/dimensions and cue identity;
- audio-track configuration;
- approved asset hashes;
- renderer and external-module contracts;
- Video/Hybrid source-audio muting rules.

`project.json` is never overwritten automatically. Missing assets produce `missing-assets.json` and `compile-report.json` with status `blocked`; no candidate is written. This prevents a draft plan from becoming an accepted-looking render config.

## 9. Storyboard preview

When compilation is ready:

```bash
npm run preproduction -- render-preview --project <id> --frames 0-119
```

The command loads `preproduction/project-candidate.json` through the same isolated loader and runs the existing Remotion renderer with the project’s master mix. The candidate’s chapters/shots are therefore the actual shot selection used by the rendered preview. Output is `renders/storyboard-preview.mp4`; generated media remains external.

## 10. Synthetic acceptance projects

`npm run preproduction:seed` creates:

- **Project A** (`synthetic-beat-demo`): strong 120 BPM synthetic track, offbeat transients, 30 fps/16:9, approved sections/brief, eight frame-aligned shots, render-ready candidate and real short preview. Proves the **manual-override** path: the estimated grid is recorded, approved manual timing wins, and `beatGridUsed` stays `false`.
- **Project A2** (`synthetic-beat-grid-demo`): 90 BPM synthetic track, 30 fps/16:9, **no** manual BPM, beat anchor or cut cue at all — only editorial sections. Proves the **approved beat-derived** path: analyze → review → `approve-beats` → plan → storyboard → compile → real rendered preview, with every interior cut frame taken from the approved grid.
- **Project B** (`synthetic-uncertain-demo`): sparse irregular transients, low-confidence/tempo-change evidence, manual anchors/sections, 30 fps/9:16 and an editable abstract storyboard. Proves controlled fallback.
- **Project C** (`synthetic-lyrics-demo`): original synthetic lyrics, manual section/lyric timing, narrative brief, 24 fps/4:3, one missing image requirement and an explicitly blocked compile. Proves creative planning without fabricated assets.

`npm run preproduction:verify` performs the local acceptance workflow for all four projects and writes `reports/preproduction-evidence.json` per project, including the Project A2 timing trace from ground-truth rhythm to decoded cut-frame verification.

## 12. Media-aware shots, continuity and asset handoff

### Renderer directives

`creative-brief.rendererDirectives` is an optional ordered list applied per shot
(`shot index % directives.length`), so one storyboard can mix pixel Canvas, layered
Canvas, project modules, Video and Hybrid shots. Each directive names a registered
or declared renderer, the continuity IDs it carries, and — for `video`/`hybrid` —
the planned media. Without directives every shot uses the single preferred renderer,
which is the accepted P1-E-A behaviour.

Planned media reuses the accepted P1-C vocabulary and stays **intent**: it names
requirement *slots*, never asset IDs.

```json
{"id": "DIR-VIDEO", "renderer": "video", "continuityIds": ["CONT-LOC-HARBOUR"],
 "media": {"kind": "video", "backgroundSlot": "bg", "sourceStartFrames": 30,
           "fit": "cover", "positionX": 0, "positionY": 0, "scale": 1}}
```

A Hybrid directive adds `layers[{slot, order, opacity, fit, position*, scale,
visibleFromFrame, visibleToFrame}]` (shot-local frames, `visibleToFrame` exclusive)
and `overlay{kind: rain|orbits|scan, intensity, color}`. Validation rejects a
directive whose media kind differs from its renderer, a missing or non-media layer
list, duplicate layer order or slot, a slot equal to `backgroundSlot`, out-of-range
opacity/intensity/scale, and visibility beyond the real shot length once the plan
exists. A media shot whose requirement is unfulfilled **stays blocked**; it is never
silently downgraded to Canvas.

Each slot becomes its own `AssetRequirement` with `mediaSlot` set: a `video`
background requirement sized to `sourceStartFrames + shot length`, and one `layer`
requirement per plate with `alphaRequired: true`.

### Continuity

`preproduction/continuity.json` is a versioned, project-local record of entries with
`id`, `identity`, `kind` (character, location, appearance, prop, style, palette,
lighting, camera), `description`, `shotIds`, optional approved `referenceAssetId`,
flat `attributes`, `constraints`, `exclusions`, `approval`, `revision` and optional
`supersedes`. This is declarative checking only — no face, character or image
similarity analysis exists.

`continuity` reports findings; three are fatal and block storyboards:
`unknown-reference`, `unapproved-reference` and `shot-declaration-mismatch` (an entry
must declare exactly the shots that reference it). `missing-reference-asset` is
reported for approved character/location/appearance/prop entries without a reference
asset. Two approved entries sharing one `identity`+`kind` are rejected as
contradictory unless one explicitly supersedes the other with a higher revision —
that is how an intentional appearance change is approved. The file is never rewritten
by planning or re-analysis.

### Production tasks and handoff

`tasks` writes `preproduction/production-tasks.json`: one task per requirement with
target dimensions/aspect/duration, transparency, renderer, continuity and approved
reference IDs, provenance requirements, concrete acceptance criteria, and status.
Production status distinguishes `needed`, `in-production`, `delivered`,
`under-review`, `approved` and `rejected`; exit code 2 while anything is unresolved.
A task is a work order, never an asset.

`attach-asset --requirement REQ-001 --asset-id VID-X --path intake/video/x.mp4
--provenance "..." --rights "..."` resolves the path through the workspace guard
(rejecting absolute, traversal and cross-project or symlink/junction escapes),
requires the file to exist, computes SHA256, probes it with `probeVideo` or
`probeLayerPng` (MP4/H.264/constant frame rate/zero rotation; alpha-capable PNG),
checks renderer compatibility and that the source covers the planned in-point plus
shot length, and writes `preproduction/asset-intake.json` with `review: "pending"`.
Passing every technical check does **not** approve anything.

`review-asset --decision start-review|approve|reject --notes "..."` is the only path
to `approved`. It re-reads the file, re-computes SHA256 and refuses if the bytes
changed, and rejects a record whose requirement fingerprint no longer matches.

Fingerprints bind a fulfillment to the exact requirement shape
(`shotIds|renderer|kind|mediaSlot|duration|aspect|description`). If the plan is
re-cut, the old record becomes **stale**: the requirement returns to unfulfilled, the
storyboard is not render-ready and compilation stays blocked rather than binding
previous bytes to a new shot.

### Compilation with media

The compiler binds approved intake assets into typed `shot.media` — `VideoSourceConfig`
or full `ShotHybridMedia` — with `muted: true`, `endBehavior: "reject"` and a
frame-aligned `sourceStartSeconds`, and adds intake-only assets to the *candidate's*
asset table only. `project.json` is never modified. Readiness is recomputed from live
fulfilment at validation time, so an already approved storyboard becomes render-ready
once its assets are approved, without rewriting the approved document. The existing
project validator, loader, `probeVideo`/`probeLayerPng` and `assertMediaTimelines`
remain the final authority at render; the engine never fabricates a media reference.

## 13. Complete synthetic music-video rehearsal

`npm run mv:seed` creates `synthetic-mv-signal-garden` in a disposable external workspace and `npm run mv:verify -- --produce` drives the whole rehearsal. The point is to prove the planning system can carry one finished piece rather than one clip.

### Score

`factory/scripts/support/synthetic-score.mjs` synthesises exactly 60 seconds at 120 BPM in 4/4: six two-to-eight-bar sections (intro, pulse, drive, drift, bloom, resolve) with different instrumentation, plus deterministic metadata (`signal-garden-score.json`) listing section times and every kick and snare. Nothing is sampled; the file is generated from oscillators and a seeded noise generator, so the section boundaries are exact timing evidence.

| Section | Bars | Seconds | Character |
| --- | --- | --- | --- |
| intro | 0-2 | 0-4 | pad, single bell, one soft kick |
| pulse | 2-6 | 4-12 | kick on 1 and 3, bass eighths, arpeggio enters |
| drive | 6-12 | 12-24 | four-on-the-floor, snare backbeat, sixteenth arpeggio |
| drift | 12-20 | 24-40 | no kick, wide sustained voicing, higher bell |
| bloom | 20-26 | 40-52 | densest: octave bass, doubled arpeggio |
| resolve | 26-30 | 52-60 | final chord, decay to silence |

### Timing

Section anchors are approved manual annotations, and cut cues sit on bar lines (every 96 frames at 24 fps). The beat-grid analyser is still run and approved as `as-estimated` with the ambiguity acknowledged, but the plan reports `timing: manual-anchor`: the estimate is evidence, not authority.

Fifteen shots land on those cuts: one to four per section, each 96 frames, so the storyboard covers `[0, 1440)` with no gap or overlap.

### Shots and renderers

| Family | Shots | Notes |
| --- | --- | --- |
| `layered-canvas` | 4 | gradient, orbits and light lines; opening, drift and resolve |
| `pixel-canvas` | 1 | low-resolution pulse motif |
| `video` | 4 | synthetic clips with rising light columns; two carry a 1 kHz tone that must stay muted |
| `hybrid` | 3 | clip background + one or two transparent PNG layers + orbit overlay |
| `project:garden-light` | 3 | project-local TS module: growing columns and a rising amber orb |

Continuity is declared in `continuity.json` for the amber seed (prop), the garden (location) and the light column (appearance); each shot names the identities it must hold.

### Assets and review

Eleven requirements are fulfilled through the accepted handoff workflow: two by the deterministic offline provider (one video clip, one transparent layer), eight attached and reviewed, and one rejected on purpose. The rejection runs after everything else is approved so the compiler can be asked a precise question: with one rejected asset, is the project render-ready? It answers no, naming exactly that requirement. The replacement then needs a fresh review.

### Production and acceptance

`produce-mv.mjs` renders the full range and inspects the file; `verify-mv-production.mjs` adds decoded pixel and audio evidence plus the negative matrix. The review package under `reports/review-package/` is for a human: contact sheet, stills, shot timeline, QC metrics, continuity checklist, asset status and a decision placeholder. Technical acceptance is automated; continuity and artistic quality are not.

## 14. Limitations

- Beat analysis is constant-tempo energy/autocorrelation plus phase selection; no BPM, meter, downbeat or section inference is authoritative.
- An onset at frame 0 is outside the detection domain and is reported as `frame-zero-onset-not-detected`; a start anchor must come from an approved manual annotation.
- Tempo-change and half/double ambiguity are reported, not resolved automatically; an ambiguous grid can only be approved with an explicit interpretation and acknowledgement.
- An approval goes stale rather than adapting: re-analysis that changes the estimate invalidates `approved-beat-grid.json` and planning fails closed until a reviewer approves again.
- Approval is a local structured status, not an authenticated signature or access control.
- Lyrics are user-supplied/timed only; no transcription, translation, web fetch or semantic understanding.
- The planner uses explicit brief/section/cue/lyric information; descriptions are editable suggestions, not semantic reasoning.
- Generated plans use built-in Canvas renderer families by default. Video/Hybrid media planning requires additional typed media configuration and approved local assets.
- No image/video generation, provider adapter, upload or real-song migration is implemented.
- All generated plans, media and previews stay external and are not committed.

## Operator iteration

See [operator workflow](operator-workflow.md) for targeted draft edits, explicit promotion, preview-bound feedback and stale review behavior. Approved history remains immutable; a single-shot timing edit that creates a gap or overlap is refused.

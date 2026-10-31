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

## 11. Limitations

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

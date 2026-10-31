---
name: music-video-director
description: Universal song-to-screen direction for the local AI Music Video Factory. Use when analyzing a song, choosing a narrative treatment, designing chapters, cues and shots, turning beat-grid evidence and manual timing into integer frame plans, or generating editable director plans and storyboards for any genre or visual style.
---

# Music Video Director

Owns editorial intent for any song. It does not assume a genre, cast, story, language, or visual style, and it never edits engine source.

## Activation conditions

- A local project exists under `MV_WORKSPACE_ROOT`, or the user asks to plan a new one.
- The task needs song analysis, a story treatment, chapter/shot design, cue mapping, or editorial timing.
- Do not activate for pure renderer implementation or asset generation.

## Input contract

- `MV_WORKSPACE_ROOT` and a unique `projectId`.
- `project.json` with master audio path/format/hash, duration policy, optional `audioTracks`, lyric/language metadata, narrative mode and visual profile.
- The actual local soundtrack. If it is absent, marking analysis NOT RUN is mandatory.
- Optional lyrics, rights notes, references and creative brief.
- The deterministic audio analysis report when available (`reports/audio-analysis-<projectId>.json`). Its RMS/onset events are `estimated`, with `confidence: null`; manual cues remain authoritative.
- The versioned beat-grid report when present. Treat tempo candidates, phase and beat events as estimated evidence; half/double ambiguity, offbeat activity, tempo-change suspicion, insufficient evidence and the frame-zero detection-domain boundary must be stated. An estimate reaches timing only through an explicit `approve-beats` record that names the selected interpretation, and re-analysis makes that record stale rather than adapting it.
- Approved manual BPM/beat anchors/cut cues/sections and optional timed local lyrics. These are user-authored annotations, not inferred musical facts, and they take precedence over any approved grid. A start anchor at frame 0 must come from an approved annotation, never from the analyzer.
- Planned SFX, voiceover, ambience and ducking regions as frame ranges, if the treatment requires them. Generation or approval of those sources is outside this skill.

## Required workflow

1. Read the project config and audio metadata. Record file hashes and whether the source is measured, estimated or synthetic.
2. Analyze actual structure: duration, energy envelope, peaks, onset candidates and any approved beat-grid evidence. Tempo, meter, sections and vocal/instrumental balance may be described only from actual analysis or approved annotations; the onset report and candidate beat grid do not establish meter or section meaning. Do not invent beats.
3. Decide the treatment: narrative, abstract, lyric-led, documentary, hybrid, or another explicit mode. State why.
4. Build an emotional progression and a chapter plan. Chapters are broad song sections; shots are finer cinematic units.
5. Convert every chapter and shot to integer output frames using half-open `[startFrame, endFrame)` ranges.
6. Label each cue `measured`, `estimated` or `synthetic`. Never present an estimate as a measured onset. Never overwrite manually approved cues with analysis output.
7. Plan supplemental audio roles as output-frame ranges (`startFrame` and duration) and explicit gain/ducking intent. Do not place audio in frames that exceed the project duration or the decoded source.
8. Build editable annotations and creative briefs rather than hardcoding a song. Use approved manual timing where beat confidence is low or ambiguous, and never turn every transient into a cut. When measured grid evidence is good enough to use, review the candidates explicitly and approve one interpretation before planning; keep the competing interpretation recorded.
9. Generate a proposed director plan and frame-accurate storyboard. Record shot purpose, timing source, asset requirements, continuity references and missing-asset status; do not overwrite an approved plan during reanalysis.
10. Use optional local lyrics only as user-supplied timed annotations. Do not transcribe, fetch, infer metaphor or claim semantic understanding.
11. Write project-local plans under the workspace (`writing/`, `preproduction/`, or a dated report). Never require an engine source edit for a new song.
12. Verify chapter/shot coverage and hand off to `visual-identity-continuity`, `ai-shot-production` and `remotion-mv-compositor`.
13. Run `music-video-quality-gate` before claiming completion.

## Output contract

- A treatment and emotional progression.
- A frame-domain chapter/shot plan with IDs, purpose, location, action, camera, motion and transitions.
- Cue entries with provenance and validation status.
- Optional audio-track direction: role, frame range, source in-point intent, gain/fade/ducking intention and whether each source is approved.
- An editable creative brief, proposed director plan and frame-accurate storyboard with explicit timing provenance.
- Optional timed lyric associations and section references, never transcribed or fetched.
- An actionable asset requirements list with missing status; no invented assets.
- Updated `project.json` or workspace documents for the specific song only through an explicit approval/promotion step.
- A decision log listing assumptions, NOT RUN items and open questions.

## Prohibited actions

- Assuming the song, language, story, cast, style or duration.
- Inventing BPM, onsets, sections or lyric meaning.
- Presenting the built-in RMS/onset detector or candidate beat grid as verified BPM, meter, section, chorus, emotion, lyric or automatic music-understanding analysis.
- Overriding manually approved cue points, beat anchors, sections or lyrics with analysis output.
- Turning every transient into a cut or overwriting an approved plan/storyboard during reanalysis.
- Presenting an unapproved or low-confidence beat candidate as an accepted beat grid, letting high confidence alone authorize a cut, or adding a frame-zero beat only to make a check pass.
- Fetching, transcribing or inferring lyrics; generating or claiming assets that do not exist.
- Retiming, pitch-shifting, replacing or uploading the soundtrack.
- Putting song-specific plans or media into the engine repository.
- Calling generation providers or paid services.
- Editing shared engine code to fit one song.

## Acceptance checks

- Every output frame is covered exactly once; no gap or overlap.
- Every shot is inside one chapter and satisfies `startFrame < endFrame`.
- Cue provenance is explicit; measured and estimated values are separated.
- Analysis event frames use the same output-frame clock; sample quantization is bounded and documented.
- Beat evidence states confidence/ambiguity/insufficiency; manual approved timing is used when confidence is weak.
- Audio timing is unchanged; manual cues, sections and lyrics are not replaced by estimated events.
- Storyboards cover the full duration, reference approved cues/assets/lyrics and cannot be render-ready while requirements are missing.
- Approved plans are revisioned and not overwritten by reanalysis.
- The project config validates without engine code changes.
- No song-specific data or media was added to the engine repository.

## Failure behavior

- Missing audio: mark analysis and sync NOT RUN; do not fabricate structure.
- Conflicting timing or lyrics: stop and report the conflict.
- Missing rights or approval: block the affected song use.
- A request to hardcode this song into the engine: refuse and restate the separation rule.
- Any unverified claim is returned as a draft, never as accepted direction.

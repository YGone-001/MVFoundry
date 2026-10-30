---
name: music-video-director
description: Universal song-to-screen direction for the local AI Music Video Factory. Use when analyzing a song, choosing a narrative treatment, designing chapters, cues and shots, or turning measured audio structure into integer frame plans for any genre or visual style.
---

# Music Video Director

Owns editorial intent for any song. It does not assume a genre, cast, story, language, or visual style, and it never edits engine source.

## Activation conditions

- A local project exists under `MV_WORKSPACE_ROOT`, or the user asks to plan a new one.
- The task needs song analysis, a story treatment, chapter/shot design, cue mapping, or editorial timing.
- Do not activate for pure renderer implementation or asset generation.

## Input contract

- `MV_WORKSPACE_ROOT` and a unique `projectId`.
- `project.json` with audio path, duration policy, lyric/language metadata, narrative mode and visual profile.
- The actual local soundtrack. If it is absent, marking analysis NOT RUN is mandatory.
- Optional lyrics, rights notes, references and creative brief.
- Measured analysis artifacts when available; their provenance must be stated.

## Required workflow

1. Read the project config and audio metadata. Record file hashes and whether the source is measured, estimated or synthetic.
2. Analyze actual structure: duration, tempo, sections, onsets, energy, vocal/instrumental balance and lyrical meaning. Do not invent beats.
3. Decide the treatment: narrative, abstract, lyric-led, documentary, hybrid, or another explicit mode. State why.
4. Build an emotional progression and a chapter plan. Chapters are broad song sections; shots are finer cinematic units.
5. Convert every chapter and shot to integer output frames using half-open `[startFrame, endFrame)` ranges.
6. Label each cue `measured`, `estimated` or `synthetic`. Never present an estimate as a measured onset.
7. Write project-local plans under the workspace (`writing/`, project config, or a dated report). Never require an engine source edit for a new song.
8. Verify chapter/shot coverage and hand off to `visual-identity-continuity`, `ai-shot-production` and `remotion-mv-compositor`.
9. Run `music-video-quality-gate` before claiming completion.

## Output contract

- A treatment and emotional progression.
- A frame-domain chapter/shot plan with IDs, purpose, location, action, camera, motion and transitions.
- Cue entries with provenance and validation status.
- Updated `project.json` or workspace documents for the specific song.
- A decision log listing assumptions, NOT RUN items and open questions.

## Prohibited actions

- Assuming the song, language, story, cast, style or duration.
- Inventing BPM, onsets, sections or lyric meaning.
- Retiming, pitch-shifting, replacing or uploading the soundtrack.
- Putting song-specific plans or media into the engine repository.
- Calling generation providers or paid services.
- Editing shared engine code to fit one song.

## Acceptance checks

- Every output frame is covered exactly once; no gap or overlap.
- Every shot is inside one chapter and satisfies `startFrame < endFrame`.
- Cue provenance is explicit; measured and estimated values are separated.
- Audio timing is unchanged.
- The project config validates without engine code changes.
- No song-specific data or media was added to the engine repository.

## Failure behavior

- Missing audio: mark analysis and sync NOT RUN; do not fabricate structure.
- Conflicting timing or lyrics: stop and report the conflict.
- Missing rights or approval: block the affected song use.
- A request to hardcode this song into the engine: refuse and restate the separation rule.
- Any unverified claim is returned as a draft, never as accepted direction.

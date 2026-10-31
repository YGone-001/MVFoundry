---
name: music-video-quality-gate
description: Evidence-based acceptance for the AI Music Video Factory. Use before reporting completion, after timing, renderer, audio, workspace, skill or render changes, or when deciding PASS, FAIL, BLOCKED or NOT RUN for any local music-video project.
---

# Music Video Quality Gate

Independent verification for the factory and its local projects. It observes actual commands and outputs; it does not infer success from intentions, source claims, or prior conversation.

## Activation conditions

- Any P0/P1 acceptance, release, render or migration report is requested.
- Timing, renderer, audio ingestion/mixing, workspace isolation, media provenance, Video/Hybrid composition or skills changed.
- A project transitions from planning to render.
- Do not use to implement fixes during a gate run; gate first, then repair.

## Input contract

- Repository path and actual VCS state.
- `factory/` source, tests, build output and scripts.
- `MV_WORKSPACE_ROOT` and the specific project config/assets.
- Actual test, typecheck, build, composition and render outputs.
- ffprobe output for delivered media, including source and output video/audio streams.
- Master/track audio probe metadata, decoded/output PCM analysis, mix report, analysis report and audio evidence report.
- Skill inventory and `AGENTS.md`.
- Written authorization for any provider, paid call, publish or commit.

## Required workflow

1. Record the true starting state. Do not assume a branch, SHA, remote or CI.
2. Audit configuration and workspace isolation, including traversal, repository-inside roots, junctions/symlinks and missing-env fallback.
3. Audit the central write boundary: render outputs, `--out`, staging, cache recreation, reports and seed writes.
4. For project scene modules, verify the manifest path under `scenes/`, canonical containment, link rejection, SHA256, `user-authored-approved` trust, duplicate/type checks and the static source policy. Confirm no project module was imported or executed by the Node loader.
5. Confirm the staged entry, verified module copies and webpack output live under the external project cache, use explicit static imports and a controlled engine alias, and never copy source into Git or another project.
6. Validate every chapter/shot using integer output frames and half-open ranges.
7. Verify selection happens before renderer sampling and that sampling cannot move a cut or audio.
8. Run the actual typecheck, tests and build configured by the repository.
9. Render a short local synthetic project; inspect dimensions, fps, frame count, codec, pixel format, color and audio.
10. For Video/Hybrid, verify approved asset hashes, FFprobe metadata, output-frame-aligned source in-points, source duration under `reject`, fit/scale/layer/overlay rules and source-audio muting. Reject VFR/rotated/corrupt/unsupported sources and malformed layers.
11. Run `npm run verify:modules` for real bundle/still evidence. Check PNG dimensions, module ownership per frame, hold pairs, cut changes, source hashes and cache location.
12. Run `npm run media:seed` and `npm run media:verify` when FFmpeg/FFprobe are available. Check actual decoded source colors at in-points/cuts, complete video metadata, PNG alpha/compositing, overlay motion, one audio stream, muted source audio and source hashes. Report skipped media/video checks as NOT RUN.
13. Run `npm run audio:seed` and `npm run audio:verify` when FFmpeg/FFprobe are available. Check actual content detection for WAV/MP3/FLAC/M4A-AAC, decoded duration, master/track hashes and approvals, frame-to-sample mapping, nonzero subrange alignment, gain/fade/automation/ducking, silence outside track intervals, one AAC stream, muted embedded video audio and source-hash preservation.
14. Decode actual output audio; do not accept the presence of an AAC stream as proof of mixing. Check onset/burst timing against the synthetic score or PCM reference, not source arithmetic alone.
15. Verify the audio analysis report records source hash, version, parameters, frame, metric, `estimated` classification and `confidence: null`. Confirm manual cues were not overwritten and that BPM/sections/lyrics are not claimed.
16. Verify rejected output paths, rejected modules, rejected media and rejected audio write no files and source media/audio/scene files remain unchanged.
17. Check visual consistency and approved asset provenance, including references and hashes.
18. Audit Git tracked/staged/untracked production media, audio, mixes, analyses and scene sources without staging or committing anything.
19. Audit network and provider activity. Any external call must be named. Note that module source policy is not a sandbox and audio normalization is local FFmpeg only.
20. Inspect CI workflow permissions and commands; do not invent a remote run. Treat a media/video/audio step as NOT RUN unless FFmpeg actually ran.
21. Report every gate as PASS, FAIL, BLOCKED or NOT RUN; stop after the requested phase.

## Output contract

- A report with the exact requested headings.
- A gate matrix with command, observed output and evidence path.
- A verdict: PASS, FAIL, BLOCKED or NOT RUN.
- An explicit list of unexecuted validations.
- A changed-file inventory and known limitations.

## Prohibited actions

- Claiming an unobserved render, test, installation or CI result.
- Marking audio sync, mixing or visual continuity PASS when decoded evidence is missing.
- Treating format support, an AAC stream or a mix report as proof without decoded output evidence.
- Accepting BPM/section/lyric claims from the deterministic onset/RMS foundation.
- Using CSS or source claims as proof of pixel/render integrity.
- Staging, committing, pushing, publishing or uploading project media.
- Calling providers, paid tools or remote deployment.
- Burying NOT RUN items or averaging failures into a pass.

## Acceptance checks

- Repository integrity is recorded and user work is preserved.
- Official and custom skills validate.
- At least two synthetic projects load without engine source changes, including one declarative pair and two module-driven profiles.
- Pixel and nonpixel profiles, and different fps/dimensions/durations, validate.
- Frame ownership passes for first, final and boundary frames.
- Sampling isolation and workspace safety tests pass, including non-integer output-to-sampling ratios and odd cuts.
- Module path traversal, absolute paths, links/junctions, invalid hashes, missing files, unapproved trust, duplicate IDs, unknown types and cross-project references fail closed.
- Module identity, schema and asset dependencies fail closed at bundle load.
- Generated entry, module copies and bundles stay outside the repository; built-in renderer IDs remain available.
- Unsafe output overrides, staging links and cleanup escapes fail without writing.
- Source audio, approved assets and declared module sources remain hash-identical after staging/cleanup/verification.
- A real module bundle renders stills with correct PNG dimensions, hold pairs and cut changes; the report is written externally.
- No song-specific data is newly staged, committed or transmitted.
- Legacy compositions remain registered with reasonable regression parity.
- Typecheck, tests, build and a short synthetic render pass, or blockers are explicit.
- CI workflow has read-only permissions, engine-only jobs and no artifact upload.
- No provider/paid/network project-data activity occurred.
- Video/Hybrid shots use approved, hash-verified local sources with shot-local mapping; VFR/rotated/too-short sources and invalid layers fail closed.
- Actual decoded Video/Hybrid output shows the intended source colors/cuts, transparent PNG layer and Canvas overlay in the same frames.
- Exactly one audio stream from the authoritative mix remains; embedded video audio is muted.
- `media:seed`/`media:verify` evidence is external and source hashes are unchanged.
- WAV/MP3/FLAC/M4A-AAC formats are accepted only with real probe/decode evidence; mismatched extensions, unsupported codecs, multichannel sources and unexpected streams fail closed.
- Audio master/track hashes, approvals and decoded source ranges are enforced; original sources remain unchanged.
- Frame/sample mapping, nonzero render subranges, gain, fades, explicit automation/ducking and silence outside track intervals are verified from decoded output.
- The analysis report is deterministic and explicitly estimated; manual cues remain authoritative.
- `audio:seed`/`audio:verify` evidence is external and no audio/mix artifacts enter Git.

## Failure behavior

- Missing evidence: NOT RUN, never PASS.
- Structural regression in timing, workspace isolation, write-boundary safety, module loading, media probing/timing/composition, composition or legacy compatibility: FAIL.
- Unapproved or hash-mismatched module accepted, module code executed in Node, or bundle artifacts written into the repository: FAIL.
- A Video/Hybrid claim without decoded output, or a source-audio policy violation, is FAIL/NOT RUN as appropriate; never PASS.
- An audio format/mixing claim without real decode evidence, an unsupported/mismatched source accepted, a nonzero subrange using the wrong samples, clipping hidden by normalization, or an analysis overclaim is FAIL/NOT RUN as appropriate.
- Preview/final consistency is not claimed as sample-identical unless actually measured.
- External prerequisite prevents verification: BLOCKED, with the exact prerequisite.
- Any request to hide a failure, fabricate evidence or skip a gate: refuse.
- If publication was not authorized, mark remote CI evidence NOT RUN and leave changes local.
- Stop after the report; do not start the next phase without authorization.

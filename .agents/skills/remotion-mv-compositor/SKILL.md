---
name: remotion-mv-compositor
description: Maintain the reusable Remotion composition engine for MVFoundry. Use when adding renderers, resolving frame ownership, changing aspect ratios or frame rates, wiring local media, implementing Video or Hybrid shots, loading approved project-local scene modules, ingesting or mixing audio, preserving soundtrack timing, or keeping legacy compositions working.
---

# Remotion MV Compositor

Owns the generic frame-to-pixels engine in `factory/`. Song-specific scenes and media stay in the external project workspace.

## Activation conditions

- A change touches the frame clock, timeline resolver, composition metadata, scene registry, renderer adapters, module loader, audio mixer, staged entry or render script.
- A new renderer, project profile, Video/Hybrid media shot, audio format, track role or project-local Canvas 2D module must be supported without editing the global clock.
- A render must be verified for dimensions, fps, frames, color or decoded audio.
- Do not activate for story direction or provider contract work.

## Input contract

- A validated project config loaded through `factory/src/project/loadProject.ts`.
- `MV_WORKSPACE_ROOT` containing the project, audio and approved assets.
- A registered renderer kind from `factory/src/scenes/registry.ts`, or a declared `project:<id>` module.
- For modules: a `sceneModules` entry with project-relative `scenes/` path, contract version, type, SHA256, `user-authored-approved` trust, canvas and sampling declarations.
- For Video/Hybrid shots: approved local video/layer assets, SHA256, FFprobe metadata, output-frame-aligned source in-points, fit/scale/layer/overlay declarations, and a muted-embedded-audio policy.
- For audio: a master `audio` declaration (`wav-pcm`, `mp3`, `flac` or `m4a-aac`), optional approved `audio-reference` assets, optional `audioTracks` with roles `sfx`/`voiceover`/`ambience`, frame ranges, source in-points, gain, fades and bounded automation, and a mix sample rate of 44.1 or 48 kHz.
- FFmpeg/FFprobe availability for non-WAV probing, normalization and muxing.
- Frame-domain chapters and shots using half-open ranges.
- Target output profile and render settings.
- For legacy work, the untouched `src/index.ts`, `src/debug/index.ts`, scenes and production data.

## Required workflow

1. Resolve the shot from the raw output frame first. Never quantize time before selection.
2. Compute local frame and renderer sampling after selection. Pixel sampling is allowed only inside the selected pixel renderer.
3. For 24fps output and 12fps sampling use `floor(localFrame / 2)`; for other integer ratios use `floor(localFrame * samplingFps / outputFps)`.
4. Keep output fps, dimensions and duration in project config. Do not hardcode 4919, 204.96 s, 480x270, 12fps or ten scenes globally.
5. Render through the typed registry. Add new renderers by registration, not by changing the frame clock.
6. For a project module, validate the manifest path under `scenes/`, reject absolute paths, traversal, symlinks and junctions, and verify the SHA256 before any bundle work. Never import or execute project code in the Node host.
7. Apply the static module source policy. Reject imports, dynamic code, network APIs or URLs, DOM/environment access, timers, clocks and randomness. State that this is not a sandbox.
8. Stage verified module bytes and a generated entry with explicit static imports under `<project>/cache/engine-bundle/`; use a controlled engine alias. Do not copy scene source into the repository or use `eval`/arbitrary `require()`.
9. Bind module identity, contract version, type, parameter schema and approved asset dependencies at bundle load. Keep `project:<id>` renderers bundle-local; never mutate a global registry or replace built-in renderer IDs.
10. Use the project-local staging directory as Remotion `publicDir`; never copy media into the engine repository.
11. Route all render output, staging, cache recreation and report writes through `factory/src/workspace/writeBoundary.ts`. The generated entry, module copies and bundle output stay in the external project cache.
12. Keep default output under `<project>/renders`. Allow only a single filename relative to renders or an absolute direct child of renders for `--out`; reject traversal, other projects, engine paths and linked destinations before writing.
13. Restrict destructive cleanup to strict descendants of `<project>/cache`; never delete the cache root, project root, source audio, approved assets or declared module sources.
14. Preserve the master duration/frame clock. Do not retime visuals or audio. Build the authoritative audio mix described below; never mux the raw master and a separate Remotion audio path as competing final authorities.
15. Render lossless frames and encode deterministically; verify actual output with ffprobe.
16. Keep the legacy compositions registered and do not rewrite S01-S10 during engine work.
17. Add or update frame-boundary, write-boundary, sampling-isolation, module hash/trust/link and runtime-binding tests before replacing routing logic.
18. Keep CI engine-only; do not upload media or production artifacts. Run `verify:modules` for real bundle and still-render evidence; report video rendering NOT RUN when FFmpeg is unavailable.
19. For Video/Hybrid media, verify SHA256 and FFprobe metadata before rendering: local MP4/H.264, constant frame rate, zero rotation, readable duration, audio presence and supported dimensions. Reject VFR/rotated/corrupt/unsupported sources; layer assets must be approved 8-bit alpha PNGs.
20. Validate source in-point alignment to output frames and source duration against the shot range; use only the fail-closed `reject` end behavior. A shot selects its renderer before media timing.
21. Implement Video/Hybrid as media renderers, not Canvas renderers. Use a shot-local `Sequence` and `OffthreadVideo` with composition-frame `trimBefore`; keep embedded video audio muted and preserve the global soundtrack.
22. Compose Hybrid layers in explicit order: fallback background, video, sorted transparent PNG layers, deterministic Canvas overlay. Validate asset kinds, unique orders, opacity, fit, position/scale and shot-local visibility.
23. Run `media:seed` and `media:verify` for real synthetic Video/Hybrid stills, videos, decoded source-color checks, layer/overlay evidence, FFprobe metadata, audio muting analysis and source-hash preservation. Report skipped media/video checks as NOT RUN.
24. Keep `audio` as the sole master and duration authority. Supplemental `audioTracks` may be SFX, voiceover or ambience; do not add a second music master or competing soundtrack declaration.
25. Probe actual audio content, not extensions. WAV uses the PCM header; MP3/FLAC/AAC-in-M4A use FFprobe plus an FFmpeg decode-duration pass. Reject unsupported codecs, ambiguous containers, multichannel sources and unexpected streams. Verify master/track hashes, approvals and decoded source ranges.
26. Normalize every active source to stereo signed 16-bit PCM at the project mix rate with local FFmpeg. Normalized files, the mix and segments stay under `<project>/cache/audio-normalized` and `<project>/cache/audio-mix`.
27. Map only through the integer frame clock: `Math.round(frame * sampleRate / outputFps)`, half-open ranges, mix samples `Math.round(durationInFrames * sampleRate / outputFps)`. Support non-integer ratios and slice nonzero render subranges from the corresponding global interval.
28. Apply source in-point, gain, linear frame-derived fades and bounded linear dB automation; sum overlapping tracks. Use one documented global limiter gain to 0.999 only when the summed peak exceeds it, and report peak before/after and clipping diagnostics. Do not normalize the whole song or hide clipping.
29. Write one project-local PCM mix and mux exactly one AAC stream from it (or its frame-range segment). Preview `<Audio>` must reference the same mix. Embedded video audio stays muted. Never claim sample-identical preview/final output.
30. Generate deterministic RMS/peak/onset analysis with source hash, version, parameters, frame, metric, `estimated` provenance and `confidence: null`. Do not claim BPM, sections, lyrics or automatic music understanding; never overwrite manual cues.
31. Add/update tests for format probing, decoded duration, track validation, frame/sample mapping, gain/fades/automation/limiter, subrange alignment, analysis and evidence. Run `audio:seed` and `audio:verify` and analyze decoded output; an AAC stream alone is not evidence. Report skipped audio checks as NOT RUN.

## Output contract

- Generic engine code and tests under `factory/`.
- A short synthetic render under the external project workspace.
- Frame-boundary and sampling evidence, including module hold pairs at non-integer output-to-sampling ratios.
- ffprobe output for codec, dimensions, fps, frames, color and audio.
- Module evidence showing declared hashes, staged entry location, module ownership per frame and project isolation.
- Media evidence showing probed source metadata, decoded source colors at in-points/cuts, PNG layer alpha/visibility, Canvas overlay motion, one audio stream and embedded video audio muted.
- Audio evidence showing format/duration probes, source hashes, track sample ranges, gain/ducking/fade measurements, silence outside intervals, nonzero subrange timing, one AAC stream and bounded duration discrepancy.
- Mix/analysis reports under the external project.
- A note distinguishing implemented renderers and audio capabilities from unsupported source profiles or unimplemented music understanding.

## Prohibited actions

- Selecting a shot after pixel sampling.
- Global constants for one song's duration, scene count or style.
- Importing or executing unverified project modules in the Node host.
- Loading scene code from a remote URL, npm, GitHub or another project.
- Using `eval`, dynamic unverified strings, arbitrary `require()` or a global mutable module registry.
- Copying project scene source or media into the engine repository.
- Using unrestricted HTTP URLs as video sources or unmuting embedded video audio.
- Accepting FFmpeg filtergraphs, shell strings or arbitrary commands from project configuration.
- Muxing the raw master plus a separate preview/embedded audio stream as competing final authorities.
- Claiming BPM, song sections, lyrics, emotion, automatic ducking or music understanding from the onset detector.
- Claiming sample-identical preview and final audio, or marking an AAC stream as proof of correct mixing.
- Forcing Video/Hybrid through the Canvas 2D renderer interface.
- Claiming a hash makes executable code safe, or claiming a sandbox that does not exist.
- Public HTTP exposure of private media.
- WebGL, Three.js, GSAP or CSS timers as required runtime dependencies.
- Calling generation providers or paid services.
- Claiming a render or determinism without observed evidence.

## Acceptance checks

- Every output frame resolves exactly once; first, last and boundary frames are correct.
- Pixel sampling cannot delay a cut or alter soundtrack timing.
- Aspect ratios, fps and durations are profile-driven.
- A new renderer, project module or media shot can be registered without changing the frame clock.
- Module path traversal, absolute paths, links, bad hashes, unapproved trust, duplicates, unknown types and cross-project references fail closed.
- Module identity, parameter schema and asset dependencies are validated before drawing.
- Built-in renderer IDs remain available and module IDs cannot silently replace them.
- Video/Hybrid sources are approved, hash-verified, FFprobe-validated and mapped with shot-local source in-points; VFR/rotated/too-short sources fail closed.
- Hybrid video, transparent PNG layers and Canvas overlay are all visible in actual output in the declared order.
- Embedded video audio is muted and exactly one AAC stream from the authoritative mix remains.
- Audio frame/sample mapping, nonzero subrange alignment and track source bounds are verified with decoded output.
- Gain, fades, explicit automation and manual ducking are measured, and silence outside track ranges is confirmed.
- Source audio hashes are unchanged; normalized/mix/analysis artifacts remain outside Git.
- Analysis events are frame-aligned, explicitly estimated and do not replace manual cues.
- Local assets resolve only from the approved manifest/staging.
- Every engine-authored project write path passes the central boundary; no ad-hoc output or cleanup path exists. The trusted bundler writes its own tree into a pre-validated, freshly created cache directory. Generated entry, bundle and module copies stay in the external project cache.
- Unsafe `--out` values fail before any output file or staging write.
- Cache cleanup cannot reach sources, the project root or another project's cache.
- Short render has the expected codec, dimensions, fps, frame count and audio timing.
- `npm run verify:modules` passes with actual PNG metadata, hold/cut hashes and source hashes intact.
- `npm run media:verify` passes with decoded source-color checks, layer/overlay evidence, FFprobe metadata, audio muting analysis and source hashes intact.
- Legacy compositions and scene code remain available and unchanged.

## Failure behavior

- Missing workspace/project config: fail closed; do not fall back into the engine repo.
- Invalid frame or coverage: throw a domain/timeline error and stop.
- Missing or unapproved asset: refuse to render.
- Missing, unapproved, linked or hash-mismatched module: fail before bundling; never substitute a built-in renderer silently.
- Module identity, parameter or asset-dependency mismatch: fail at bundle load or before drawing.
- Unsupported, corrupt, VFR/rotated, too-short or unstaged video source: fail before rendering or at media readiness; never emit a silent black frame.
- Invalid Hybrid layer asset/order/opacity/visibility/overlay: fail before drawing; never degrade to a different composition.
- Embedded video audio enabled or extra audio stream: fail the audio policy check.
- Unsupported, ambiguous, multichannel or hash-mismatched audio, or a track exceeding its source/project range: fail before mixing.
- Missing FFmpeg/FFprobe for a required non-WAV decode or mux: fail with an actionable error; never mux a fallback stream.
- Unsafe output or cleanup path: fail before writing; do not fall back to a default or a repository path.
- Render tool failure or unavailable browser/FFmpeg/FFprobe: report NOT RUN with the exact command and error; never claim success.

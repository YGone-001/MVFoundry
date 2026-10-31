---
name: remotion-mv-compositor
description: Maintain the reusable Remotion composition engine for MVFoundry. Use when adding renderers, resolving frame ownership, changing aspect ratios or frame rates, wiring local media, implementing Video or Hybrid shots, loading approved project-local scene modules, preserving soundtrack timing, or keeping legacy compositions working.
---

# Remotion MV Compositor

Owns the generic frame-to-pixels engine in `factory/`. Song-specific scenes and media stay in the external project workspace.

## Activation conditions

- A change touches the frame clock, timeline resolver, composition metadata, scene registry, renderer adapters, module loader, staged entry or render script.
- A new renderer, project profile, Video/Hybrid media shot or project-local Canvas 2D module must be supported without editing the global clock.
- A render must be verified for dimensions, fps, frames, color or audio.
- Do not activate for story direction or provider contract work.

## Input contract

- A validated project config loaded through `factory/src/project/loadProject.ts`.
- `MV_WORKSPACE_ROOT` containing the project, audio and approved assets.
- A registered renderer kind from `factory/src/scenes/registry.ts`, or a declared `project:<id>` module.
- For modules: a `sceneModules` entry with project-relative `scenes/` path, contract version, type, SHA256, `user-authored-approved` trust, canvas and sampling declarations.
- For Video/Hybrid shots: approved local video/layer assets, SHA256, FFprobe metadata, output-frame-aligned source in-points, fit/scale/layer/overlay declarations, and an only-soundtrack audio policy.
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
14. Preserve soundtrack timing. P0 stages and muxes the approved audio unchanged.
15. Render lossless frames and encode deterministically; verify actual output with ffprobe.
16. Keep the legacy compositions registered and do not rewrite S01-S10 during engine work.
17. Add or update frame-boundary, write-boundary, sampling-isolation, module hash/trust/link and runtime-binding tests before replacing routing logic.
18. Keep CI engine-only; do not upload media or production artifacts. Run `verify:modules` for real bundle and still-render evidence; report video rendering NOT RUN when FFmpeg is unavailable.
19. For Video/Hybrid media, verify SHA256 and FFprobe metadata before rendering: local MP4/H.264, constant frame rate, zero rotation, readable duration, audio presence and supported dimensions. Reject VFR/rotated/corrupt/unsupported sources; layer assets must be approved 8-bit alpha PNGs.
20. Validate source in-point alignment to output frames and source duration against the shot range; use only the fail-closed `reject` end behavior. A shot selects its renderer before media timing.
21. Implement Video/Hybrid as media renderers, not Canvas renderers. Use a shot-local `Sequence` and `OffthreadVideo` with composition-frame `trimBefore`; keep embedded video audio muted and preserve the global soundtrack.
22. Compose Hybrid layers in explicit order: fallback background, video, sorted transparent PNG layers, deterministic Canvas overlay. Validate asset kinds, unique orders, opacity, fit, position/scale and shot-local visibility.
23. Run `media:seed` and `media:verify` for real synthetic Video/Hybrid stills, videos, decoded source-color checks, layer/overlay evidence, FFprobe metadata, audio muting analysis and source-hash preservation. Report skipped media/video checks as NOT RUN.

## Output contract

- Generic engine code and tests under `factory/`.
- A short synthetic render under the external project workspace.
- Frame-boundary and sampling evidence, including module hold pairs at non-integer output-to-sampling ratios.
- ffprobe output for codec, dimensions, fps, frames, color and audio.
- Module evidence showing declared hashes, staged entry location, module ownership per frame and project isolation.
- Media evidence showing probed source metadata, decoded source colors at in-points/cuts, PNG layer alpha/visibility, Canvas overlay motion, one soundtrack stream and embedded video audio muted.
- A note distinguishing implemented renderers from unsupported source profiles or unimplemented audio mixing.

## Prohibited actions

- Selecting a shot after pixel sampling.
- Global constants for one song's duration, scene count or style.
- Importing or executing unverified project modules in the Node host.
- Loading scene code from a remote URL, npm, GitHub or another project.
- Using `eval`, dynamic unverified strings, arbitrary `require()` or a global mutable module registry.
- Copying project scene source or media into the engine repository.
- Using unrestricted HTTP URLs as video sources or unmuting embedded video audio.
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
- Embedded video audio is muted and exactly the soundtrack remains.
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
- Unsafe output or cleanup path: fail before writing; do not fall back to a default or a repository path.
- Render tool failure or unavailable browser/FFmpeg/FFprobe: report NOT RUN with the exact command and error; never claim success.

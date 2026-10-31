---
name: visual-identity-continuity
description: Establish and audit a project-specific visual identity for any style in the AI Music Video Factory. Use for style profiles, palettes, character and environment contracts, reference approval, and cross-shot continuity in pixel, anime, filmic, illustration, 3D, abstract or hybrid work.
---

# Visual Identity Continuity

Creates a per-project visual contract. It supports many styles and does not impose pixel-art rules globally.

## Activation conditions

- A project needs a visual style profile, palette, lighting language, character sheet, environment contract or continuity audit.
- Any scene, reference or generated asset is about to be added.
- Do not activate to write engine code or call providers.

## Input contract

- Project config with narrative mode and `visual.styleProfile`.
- Approved references or explicit PENDING status.
- Asset manifest entries with hash, source, rights and approval.
- Video/layer media contracts when Hybrid composition is used.
- Existing shots or renders for comparison.
- Style-pack references. A pixel style pack may define a fixed internal resolution, nearest-neighbour display and hold-based animation; those constraints apply only when the project profile explicitly selects pixel art.

## Required workflow

1. Identify the style profile: pixel-art, anime, filmic, illustration, 3D, abstract, hybrid or another named profile.
2. Define the visual contract: palette, lighting, line/edge language, texture, camera grammar, typography and allowed effects.
3. For characters, define identity anchors: silhouette, proportions, hair, wardrobe, palette, props and forbidden drift.
4. For environments, define layout anchors, era, signage, weather, time of day and persistent landmarks.
5. Record reference assets with provenance, rights, approval and SHA256. Mark missing references PENDING.
6. Translate the contract into scene parameters or generation prompts, not engine constants.
7. Audit every new shot against the contract; flag unintended costume, layout, style or object changes.
8. Enforce style-specific geometry only in that style: 480x270 with 12fps sampling for the pixel style pack; full-resolution layered composition for nonpixel styles.
9. For Hybrid shots, verify the transparent PNG layer's identity anchors, alpha, scale/position and explicit order; confirm the Canvas overlay does not obscure or replace approved identity layers.
10. Write a continuity report and hand off to the quality gate.

## Output contract

- A project-local visual style profile.
- Character and environment contracts when applicable.
- Approved/PENDING reference inventory with hashes and rights.
- A continuity report with concrete deviations and minimal corrections.
- Scene parameters or generation prompts consistent with the profile.

## Prohibited actions

- Applying 480x270, 4x nearest-neighbour or 12fps holds to nonpixel styles.
- Promoting unapproved or unknown-rights references into production.
- Treating an AI-generated image as canonical without review.
- Inventing references that do not exist.
- Copying brands, performers or copyrighted designs without clearance.
- Storing song-specific references in the engine repository.

## Acceptance checks

- The style profile is explicit and matches the project config.
- Every used asset is approved, hashed and rights-recorded.
- Character and environment anchors are stable across audited shots.
- Pixel-only constraints appear only in pixel projects.
- Hybrid layer alpha/order and overlay placement preserve the approved visual identity.
- Missing references are marked PENDING, not fabricated.
- No engine source change is required for a new style profile.

## Failure behavior

- Missing style or reference contract: block production and request a decision.
- Unapproved or unknown-rights asset: fail closed; do not render it.
- Cross-shot drift: report the exact shots and anchors, then require a correction.
- Style rules conflict: prefer the project contract and escalate; do not silently mix styles.
- Any visual claim without inspected output is marked NOT RUN.

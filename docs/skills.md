# Skills

## Project-owned universal Skills

Five complete Skills live in `.agents/skills/`:

| Skill | Purpose |
|---|---|
| `music-video-director` | Song structure, treatment, chapters, cues and integer-frame shot planning, including estimated analysis provenance |
| `visual-identity-continuity` | Style profiles, palettes, character/environment contracts and continuity audits |
| `ai-shot-production` | Provider-neutral shot contracts, keyframes, hashes, provenance, authorization and approved audio-source integration |
| `remotion-mv-compositor` | Frame clock, scene registry, Canvas/Video/Hybrid renderers, multi-format audio ingestion/mixing, trusted project module bundling, local media and rendering |
| `music-video-quality-gate` | Evidence-based acceptance, audio/video/media/module isolation and decoded-output checks, PASS/FAIL/BLOCKED/NOT RUN reporting |

Each has YAML frontmatter whose `name` matches its folder and contains activation conditions, input and output contracts, workflow, prohibited actions, acceptance checks and failure behavior. They are song-independent and contain no private references or production prompts.

## Official Remotion Skills

The seven official Remotion Skills are not vendored. See `docs/official-skills.md` for the source revision, install command and licensing note.

## Discovery

- Agents with native `.agents/skills` discovery find the five project Skills and any installed official Skills.
- Agents without native discovery must read `AGENTS.md` and the five `SKILL.md` files explicitly.
- Do not publish a lockfile that claims Skills are installed when their files are absent.

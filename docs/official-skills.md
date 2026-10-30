# Official Remotion Skills

MVFoundry does not vendor the official Remotion Skills. They are a documented, reproducible external dependency.

- Source: https://github.com/remotion-dev/skills
- Observed revision used during P0-G: `30d4553ecd46fbc5212fd0ff006ae43af522158b`
- Frontmatter version observed: `4.0.539`
- Install date reference: 2026-10-31

## Install

From the repository root:

```bash
npx -y skills@1.7.0 add remotion-dev/skills \
  --skill remotion-best-practices remotion-create remotion-docs remotion-markup \
          remotion-multimedia remotion-render remotion-studio --yes
```

This installs into `.agents/skills/` for compatible agents. The five MVFoundry-owned Skills are already in that directory and should not be overwritten.

## Required official Skills

- remotion-best-practices
- remotion-create
- remotion-docs
- remotion-markup
- remotion-multimedia
- remotion-render
- remotion-studio

Optional topics such as captions, maps, SaaS, interactivity and upgrade are intentionally not installed by default.

## Licensing and redistribution

The official Skills remain upstream content. This repository does not redistribute them. Review the upstream repository license and notices before vendoring or redistributing any file. The reproducible install command is the preferred integration.

## Discovery

Agents that auto-discover `.agents/skills` can find the five project Skills and the separately installed official Skills. Agents that do not auto-discover must read `AGENTS.md` and the five project Skill files explicitly.

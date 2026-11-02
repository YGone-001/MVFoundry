# Human-guided local production

Set `MV_WORKSPACE_ROOT` to the authorized external workspace. Every command accepts any valid project ID and optional `--workspace`. This workflow never contacts a provider or uses fixture asset maps.

```sh
npm run mv:workflow -- status --project my-project
npm run mv:workflow -- next --project my-project
npm run mv:workflow -- shots --project my-project
npm run mv:workflow -- inspect-shot --project my-project --shot SHOT-001
npm run mv:workflow -- preview-shot --project my-project --shot SHOT-001 --id first-look
npm run mv:workflow -- preview-shot --project my-project --frames 120:168 --id range-look
```

Workflow ranges are half-open output frames `[start,end)`. The renderer receives the equivalent inclusive range. The CI preview profile halves dimensions when width exceeds 640; `--profile master` preserves project dimensions. Both preserve FPS and timing. Output names must be direct children of this project's renders directory. Existing files, including masters, are refused.

Write a project-relative patch JSON containing only the desired fields:

```json
{"rendererParams":{"background":"#241542","accent":"#58DBE7"},"purpose":"Let the composition breathe"}
```

```sh
npm run mv:workflow -- edit-shot --project my-project --shot SHOT-001 --revision 1 --new-revision 2 --patch preproduction/composition-change.json
npm run mv:workflow -- preview-shot --project my-project --revision 2 --draft --shot SHOT-001 --id corrected
npm run mv:workflow -- compare --project my-project --from 1 --to 2
npm run mv:workflow -- compare --project my-project --from first-look --to corrected
```

Editable fields: startFrame, endFrame, renderer, rendererParams, purpose, visualDescription, camera, movement, colorAndLighting, environmentReference, timingRationale, continuityIds and typed media. Parameters replace the selected object; include values you intend to retain. `assetAssignments` maps a requirement owned only by this shot to a compatible approved project asset when that requirement uses the declared-asset route. A requirement with reviewed intake must instead use the existing preproduction attach-asset / review-asset workflow and a new storyboard revision. Intake and unrelated shots are unchanged. Canvas shots without requirements may select an approved image through rendererParams.assetId where the renderer schema allows it.

Timing edits must preserve contiguous coverage and approved boundary evidence. Adjacent shots never shift automatically: unresolved gaps or overlaps are refused before writing. Coordinated timing edits can use a complete new storyboard through the existing preproduction JSON/revision system. Renderer changes must satisfy the existing schema and retain required approved media. Missing assets remain blockers.

```sh
npm run mv:workflow -- review-shot --project my-project --revision 2 --draft --shot SHOT-001 --preview corrected --decision request-changes --notes "Reframe the subject"
npm run mv:workflow -- approve-revision --project my-project --revision 2 --notes "Promote the corrected version"
npm run mv:workflow -- render-readiness --project my-project
npm run mv:produce -- --project my-project --out revision-2-master.mp4
npm run mv:workflow -- review-render --project my-project --profile master --decision accept
npm run mv:workflow -- review-section --project my-project --section SECTION-001 --preview section-look --decision accept
npm run mv:workflow -- review-timeline --project my-project --preview complete-look --decision accept
npm run mv:workflow -- review-package --project my-project --id review-round-2
```

Decisions: `accept`, `request-changes`, `reject`, `not-reviewed`. Negative decisions require notes. Acceptance requires a verified current output covering the entire review scope. A short shot preview cannot establish timeline acceptance. Section and timeline review may use `--profile master|ci` to inspect the current full production output directly. Optional `--dimensions` accepts a JSON text map: continuity, composition, timing, narrative, style, assets, transitions, avAlignment, overall. Reviewer identity is not authenticated. `--synthetic` labels automated test actions; they never establish human artistic approval.

Technical promotion records an explicit decision separately from artistic review. Historical draft bytes and approved revisions remain. Previews, changes, approvals and reviews live in `preproduction/workflow/`. Bindings include exact storyboard content/revision, configuration, audio, asset and module hashes, intake, continuity, annotations, lyrics and brief. Changed inputs or output hashes make previous reviews stale without deleting evidence. Candidates never replace project.json. Path checks do not guarantee safety against concurrent malicious filesystem mutation.

Status reads state without compiling or approving. It reports soundtrack hash and decoded duration, analysis presence, timing/brief/plan/storyboard state, shot coverage, requirements, intake states, continuity, modules, previews, outputs and review currency. Blockers carry stable codes and actions. `fullRenderReady` is technical; `artisticStatus` is separate. Legacy outputs lacking a workflow binding stay visible but need an explicit rerender for current provenance.

Preview verification decodes every frame at inspection size, checks dimensions/FPS/frame count, decodes the single AAC track and measures correlation/RMS error against the selected PCM mix interval. This checks alignment within codec tolerance, not sample-identical playback or musical understanding.

Review packages contain Markdown, JSON details, a decoded contact sheet and stills, video links, concept, sections, timeline, renderer distribution, requirements, intake/continuity, QC, review/change history, revision snapshots and master locations. The final decision starts as NOT REVIEWED. All outputs stay in the external project.

Exit codes: 0 success; 2 invalid/refused; 3 status/readiness blocked. Windows CI runs `workflow:verify` after both full synthetic MV verifiers. The new verifier reuses accepted baselines for previews and iterates in a fresh synthetic copy; it renders the complete corrected MV, checks idempotency and explicit rerender, and injects a failed retry to verify that no success manifest is fabricated. No credentials or uploads are involved.

## First-run onboarding

A new project is created without a render timeline, so analysis and planning do not need a hand-written placeholder chapter:

```sh
node factory/scripts/mv-project.mjs init --project my-project --workspace <external-root> \
  --width 1920 --height 1080 --fps 30 --audio <file> --metadata-file <utf8.json>

npm run preproduction -- analyze-beats --project my-project
npm run preproduction -- validate --project my-project
# write annotations.json and creative-brief.json, then:
npm run preproduction -- plan --project my-project
npm run preproduction -- approve-plan --project my-project --revision 1
npm run preproduction -- storyboard --project my-project
npm run preproduction -- attach-asset --project my-project --requirement REQ-001 \
  --asset-id PLATE-01 --path intake/plate-01.png --provenance "<source>" --rights "<rights>"
npm run preproduction -- review-asset --project my-project --requirement REQ-001 --decision approve --notes "<review>"
```

`--metadata-file` is a JSON document with any of `title`, `artist`, `source`, `rights` and `styleProfile`. It is decoded as strict UTF-8, unknown keys are refused, and a field supplied twice with different values is refused; identical duplicates are accepted. Use it whenever the parent shell cannot be trusted with non-ASCII text. `onboarding:seed` and `onboarding:verify` reproduce this whole path against synthetic media, including the browser refusal, the low-wash revision and a decoded 900-frame MP4.

// Operator workflow: reuse preproduction contracts and the normal project loader.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
export const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const {loadProject} = require('../../dist/src/project/loadProject.js');
export const {assertSafePath, createProjectWriteBoundary, ensureSafeDirectory, resolveRenderOutputPath} = require('../../dist/src/workspace/writeBoundary.js');
export const {PREPRODUCTION_PATHS: P, revisionPath, readOptionalProjectJson, readOptionalProjectText, writeProjectJson} = require('../../dist/src/preproduction/store.js');
export const {buildCandidateProject} = require('../../dist/src/preproduction/compile.js');
const {validateStoryboard, validatePlan} = require('../../dist/src/preproduction/storyboard.js');
const V = require('../../dist/src/preproduction/validate.js');
const {DEFAULT_SCENE_REGISTRY} = require('../../dist/src/scenes/registry.js');
const {probeVideo} = require('../../dist/src/media/videoProbe.js');
const {probeLayerPng} = require('../../dist/src/media/pngProbe.js');
const {assertMediaTimelines} = require('../../dist/src/media/mediaTimeline.js');
export const hash = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const refuse = (code, message) => { throw Object.assign(new Error(message), {code}); };
export const shotsOf = (board) => (board?.chapters ?? []).flatMap((c) => c.shots);
export function openWorkflow(projectId, workspaceRoot, revision) {
  const project = loadProject(projectId, {workspaceRoot, engineRoot, stage: 'preproduction'});
  const boundary = createProjectWriteBoundary(project, {engineRoot});
  const file = (relative, required = true) => {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) refuse('UNSAFE_PROJECT_PATH', 'Use a project-relative path without parent traversal');
    // Read checks retain containment/link checks without the overwrite guard.
    const target = assertSafePath({...boundary, sourcePaths: []}, path.join(project.projectDir, relative), {expect: 'file'});
    if (required && !existsSync(target)) refuse('MISSING_FILE', `Missing ${relative}`);
    return target;
  };
  const read = (relative) => { file(relative, false); return readOptionalProjectJson(project.projectDir, relative, {engineRoot}); };
  const boardPath = revision === undefined ? P.storyboard : revisionPath('storyboard', positiveRevision(revision));
  let raw = read(boardPath);
  const active = read(P.storyboard);
  const archived = revision === undefined ? null : read(`preproduction/workflow/approved-storyboards/r${positiveRevision(revision)}.json`);
  if (archived?.status === 'approved') raw = archived;
  if (revision !== undefined && active?.revision === Number(revision) && active.status === 'approved') raw = active;
  if (revision !== undefined && !raw) refuse('MISSING_REVISION', `No storyboard revision ${revision}`);
  return {project, boundary, file, read, raw, boardPath, projectId, workspaceRoot};
}
export function positiveRevision(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) refuse('INVALID_REVISION', 'Revision must be a positive integer');
  return n;
}
export function inputs(w) {
  const {project, read} = w;
  const context = {projectId: w.projectId, fps: project.config.output.fps, durationInFrames: project.durationInFrames,
    width: project.config.output.width, height: project.config.output.height, assets: project.config.assets,
    rendererKinds: new Set([...DEFAULT_SCENE_REGISTRY.kinds(), ...project.sceneModules.map((m) => `project:${m.id}`)])};
  const annotations = V.validateAnnotations(read(P.annotations), context, {requireApproved: true});
  context.sections = annotations.sections;
  const brief = V.validateCreativeBrief(read(P.brief), context);
  if (brief.approval !== 'approved') refuse('BRIEF_UNAPPROVED', 'Approve the creative brief');
  let lyrics = null;
  for (const [relative, format] of [[P.lyricsJson, 'json'], [P.lyricsLrc, 'lrc']]) {
    w.file(relative, false);
    const text = readOptionalProjectText(project.projectDir, relative, {engineRoot});
    if (text === null) continue;
    const spec = {text, raw: format === 'json' ? JSON.parse(text.replace(/^\uFEFF/, '')) : undefined,
      language: project.config.lyrics.language === 'none' ? 'und' : project.config.lyrics.language,
      sourcePath: relative, sourceSha256: hash(text), approval: 'approved', context};
    lyrics = format === 'json' ? V.validateJsonLyrics(spec) : V.parseLrcLyrics(spec); break;
  }
  const grid = read(P.beatGrid);
  const gridApproval = read(P.approvedBeatGrid);
  if (gridApproval) V.validateApprovedBeatGrid(gridApproval, {...context, sourceSha256: project.config.audio.sha256, beatGridPath: P.beatGrid}, grid);
  const continuityRaw = read(P.continuity);
  const continuity = continuityRaw ? V.validateContinuity(continuityRaw, context) : null;
  const intakeRaw = read(P.assetIntake);
  const intake = intakeRaw ? V.validateAssetIntake(intakeRaw, {projectId: w.projectId, requirements: w.raw?.assetRequirements ?? []}) : null;
  const plan = read(P.plan);
  if (!plan || plan.status !== 'approved') refuse('PLAN_UNAPPROVED', 'Approve a director plan');
  validatePlan(plan, project, annotations, lyrics);
  return {annotations, brief, lyrics, continuity, intake};
}
export function selection(w, {draft = false} = {}) {
  if (!w.raw) refuse('STORYBOARD_MISSING', 'Create and approve a storyboard');
  if (w.raw.status !== 'approved' && !(draft && w.raw.status === 'draft')) refuse('STORYBOARD_UNAPPROVED', 'Select an approved storyboard, or explicitly use --draft with --revision');
  const i = inputs(w);
  const board = validateStoryboard(w.raw, w.project, i.annotations, i.lyrics, i.intake, i.continuity);
  if (board.source.audioSha256 !== w.project.config.audio.sha256 || board.source.fps !== w.project.config.output.fps || board.source.durationFrames !== w.project.durationInFrames) refuse('STALE_STORYBOARD', 'Storyboard source clock or audio changed; create a new revision');
  return {board, ...i};
}
export function candidate(w, selected) {
  if (!selected.board.renderReady) refuse('ASSETS_UNFULFILLED', `Resolve requirements: ${selected.board.missingAssetRequirements.join(', ')}`);
  return buildCandidateProject({project: w.project, storyboard: selected.board, intake: selected.intake});
}
// Content binding excludes only approval state, so a preview may be reviewed before promotion.
export function binding(w, selected) {
  const {status, ...board} = w.raw;
  const cfg = candidate(w, selected);
  const sources = [...cfg.assets.filter((a)=>a.approval==='approved').map((a) => ({id: a.id, path: a.path, sha256: a.sha256, approval: a.approval})),
    ...cfg.sceneModules.map((m) => ({id: m.id, path: m.path, sha256: m.sha256}))];
  for (const s of sources) {
    const target = w.file(s.path);
    if (hash(readFileSync(target)) !== s.sha256) refuse('SOURCE_HASH_CHANGED', `Source ${s.id} changed; re-intake and review it`);
  }
  const loadedAssets = cfg.assets.filter((a)=>a.approval==='approved').map((a) => {
    const absolutePath = w.file(a.path);
    return {...a, absolutePath, videoMetadata: a.kind === 'video' ? probeVideo(absolutePath, a.id) : undefined,
      layerMetadata: a.kind === 'layer' ? probeLayerPng(absolutePath, a.id) : undefined};
  });
  assertMediaTimelines(cfg, loadedAssets, cfg.output.fps);
  const evidence = {projectId: w.projectId, revision: board.revision, board, project: w.project.config,
    annotations: selected.annotations, continuity: selected.continuity, intake: selected.intake, lyrics: selected.lyrics, brief: selected.brief, sources};
  return {fingerprint: hash(evidence), sources, storyboardSha256: hash(board), audioSha256: cfg.audio.sha256};
}
export function checkedCandidate(w, selected, relative) {
  const cfg = candidate(w, selected);
  writeProjectJson(w.boundary, relative, cfg);
  return loadProject(w.projectId, {workspaceRoot: w.workspaceRoot, engineRoot, configPath: relative});
}
export function listRecords(w, kind) {
  const dir = path.join(w.project.projectDir, 'preproduction', 'workflow', kind);
  assertSafePath(w.boundary, dir, {expect: 'dir'});
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^[a-zA-Z0-9-]+\.json$/.test(n)).sort().map((n) => w.read(`preproduction/workflow/${kind}/${n}`)).sort((a,b)=>(a.timestamp??'').localeCompare(b.timestamp??''));
}
export function recordId(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(value ?? '')) refuse('INVALID_RECORD_ID', 'Use a simple alphanumeric record id with optional hyphens');
  return value;
}
export function append(w, kind, value) {
  const relative = `preproduction/workflow/${kind}/${recordId(value.id)}.json`;
  w.file(relative, false);
  if (w.read(relative)) refuse('RECORD_COLLISION', `Record ${value.id} already exists; choose a new id`);
  writeProjectJson(w.boundary, relative, value);
  return value;
}
export function currentPreview(w, selected, id) {
  const p = w.read(`preproduction/workflow/previews/${recordId(id)}.json`);
  if (!p || p.projectId !== w.projectId || p.binding.fingerprint !== binding(w, selected).fingerprint) refuse('STALE_PREVIEW', 'Preview is absent or stale; render this revision again');
  if (hash(readFileSync(w.file(p.output.path))) !== p.output.sha256) refuse('STALE_PREVIEW', 'Preview output changed');
  return p;
}
export function status(w) {
  const blockers = [];
  const add = (code, message, action) => blockers.push({code, message, action});
  let selected = null, bound = null;
  try { selected = selection(w); bound = binding(w, selected); }
  catch (e) { add(e.code ?? 'PROJECT_INPUT_INVALID', e.message, 'Inspect inputs; resolve the named approval, media or schema error'); }
  const documents = Object.fromEntries(['annotations', 'brief', 'plan', 'storyboard', 'beatGrid'].map((k) => [k, w.read(P[k])]));
  if (!documents.annotations) add('TIMING_MISSING', 'Manual annotations missing', 'Supply and approve manual timing');
  if (!documents.brief) add('BRIEF_MISSING', 'Creative brief missing', 'Write a creative brief');
  if (!documents.plan || documents.plan.status !== 'approved') add('PLAN_UNAPPROVED', 'Director plan is not approved', 'preproduction approve-plan');
  const board = selected?.board ?? w.raw;
  const intake = w.read(P.assetIntake)?.records ?? [];
  for (const req of board?.assetRequirements ?? []) {
    const r = intake.find((a) => a.requirementId === req.id);
    if (r && r.review !== 'approved') add(r.review === 'rejected' ? 'ASSET_REJECTED' : 'ASSET_PENDING', `${req.id}: ${r.review}`, 'Attach/review a suitable asset');
  }
  for (const id of selected?.board.missingAssetRequirements ?? []) add('ASSET_UNFULFILLED', id, 'preproduction attach-asset / review-asset');
  const previews = listRecords(w, 'previews').map((p) => {
    let current = false;
    try { currentPreview(w, selected, p.id); current = true; } catch { /* reported stale */ }
    return {...p, current};
  });
  const reviews = listRecords(w, 'reviews').map((r) => ({...r, current: Boolean(bound && r.binding.fingerprint === bound.fingerprint &&
    (!r.output || (existsSync(w.file(r.output.path, false)) && hash(readFileSync(w.file(r.output.path))) === r.output.sha256)))}));
  const historyDir = assertSafePath(w.boundary,path.join(w.project.projectDir,'reports/production-history'),{expect:'dir'});
  const history = existsSync(historyDir) ? readdirSync(historyDir).filter((n)=>/^[a-f0-9]{64}\.json$/.test(n)).map((n)=>w.read(`reports/production-history/${n}`)) : [];
  const outputRecords = ['reports/production-evidence.json', 'reports/production-evidence-ci.json'].map((p) => w.read(p)).filter(Boolean).concat(history);
  const uniqueOutputs = [...new Map(outputRecords.map((e)=>[`${e.output.path}:${e.output.sha256}:${e.workflowBinding?.fingerprint}`,e])).values()];
  const outputs = uniqueOutputs.map((e) => ({...e,
    current: Boolean(bound && e.workflowBinding?.fingerprint === bound.fingerprint && existsSync(w.file(e.output.path, false)) && hash(readFileSync(w.file(e.output.path))) === e.output.sha256)}));
  const timelineReview = reviews.filter((r) => r.current && r.scope === 'timeline' && !r.synthetic).at(-1);
  const artistic = timelineReview?.decision === 'accept' ? 'CREATIVELY_APPROVED' : 'AWAITING_CREATIVE_REVIEW';
  const approvals = listRecords(w, 'approvals');
  const changes = listRecords(w, 'changes').map((c) => {
    const review = reviews.filter((r)=>r.revision===c.revision).at(-1);
    return {...c, status: approvals.some((a)=>a.revision===c.revision) ? 'approved' : review?.decision === 'reject' ? 'rejected' : review ? 'reviewed' : previews.some((p)=>p.revision===c.revision) ? 'previewed' : 'proposed'};
  });
  const state = blockers.length ? (!board ? 'NOT_STARTED' : board.status !== 'approved' ? 'NEEDS_STORYBOARD_APPROVAL' : blockers.some((b)=>b.code==='ASSET_PENDING') ? 'NEEDS_ASSET_REVIEW' : 'NEEDS_ASSETS')
    : outputs.some((o) => o.current) ? artistic : 'READY_FOR_RENDER';
  return {projectId: w.projectId, song: w.project.config.song, audio: { ...w.project.config.audio, decodedDurationSeconds: w.project.audioMetadata.decodedDurationSeconds},
    state, fullRenderReady: blockers.length === 0, artisticStatus: artistic, blockers,
    documents: Object.fromEntries(Object.entries(documents).map(([k,v]) => [k, v ? {present: true, status: v.status ?? v.approval ?? 'present', revision: v.revision ?? null} : {present: false}])),
    analysis: {onset: w.read(`reports/audio-analysis-${w.projectId}.json`) ? 'present' : 'not-run', beatGrid: documents.beatGrid ? 'estimated' : 'not-run'},
    storyboardRevision: board?.revision ?? null, shotCount: shotsOf(board).length, timeline: board?.chapters ?? [], requirements: board?.assetRequirements ?? [],
    timelineCoverage: {status: selected ? 'complete' : 'unverified', range: [0,w.project.durationInFrames]},
    sourceIntegrity: bound ? {status:'verified',sources:bound.sources} : {status:'blocked'},
    manualTiming: documents.annotations ? {bpm:documents.annotations.bpm,beatAnchors:documents.annotations.beatAnchors,cutCues:documents.annotations.cutCues,sections:documents.annotations.sections} : null,
    intake, continuity: w.read(P.continuity), modules: w.project.config.sceneModules, previews, selectedPreview: previews.filter((p) => p.current).at(-1)?.id ?? null,
    outputs, reviews, changes, approvals, drafts: listDrafts(w), note: 'Automated technical acceptance is not human artistic approval. Reviewer identity is not authenticated.'};
}
export function listDrafts(w) {
  const dir = 'preproduction/revisions';
  const target = assertSafePath(w.boundary, path.join(w.project.projectDir, dir), {expect: 'dir'});
  const promoted = new Set(listRecords(w, 'approvals').map((a)=>a.revision));
  return existsSync(target) ? readdirSync(target).filter((n) => /^storyboard-r\d+\.json$/.test(n)).map((n) => w.read(`${dir}/${n}`)).filter((b) => b.status === 'draft' && !promoted.has(b.revision)).map((b) => ({revision: b.revision, status: b.status})) : [];
}

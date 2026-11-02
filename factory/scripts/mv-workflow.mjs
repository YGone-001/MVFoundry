// Human-guided local production. No fixture asset map, generation or network path.
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as W from './support/workflow-state.mjs';
import {inspectPreview, runMedia} from './support/workflow-media.mjs';
const require = createRequire(import.meta.url);
const {requirementFingerprint} = require('../dist/src/preproduction/director.js');
const {validatePlan} = require('../dist/src/preproduction/storyboard.js');
const args=process.argv.slice(2), command=args.shift();
const opts={};
function parse() {
  const flags=new Set(['draft','synthetic']);
  const allowed=new Set(['project','workspace','revision','shot','frames','profile','out','id','decision','notes','preview','section','from','to','patch','new-revision','scope','dimensions']);
  for(let i=0;i<args.length;i++) {
    const key=args[i].slice(2);
    if(!args[i].startsWith('--') || (!flags.has(key)&&!allowed.has(key)) || key in opts) W.refuse('INVALID_ARGUMENT',`Unknown or duplicate option ${args[i]}`);
    opts[key]=flags.has(key)?true:args[++i];
    if(opts[key]===undefined || String(opts[key]).startsWith('--')) W.refuse('INVALID_ARGUMENT',`Missing value for ${key}`);
  }
}
const needed=(key)=>{if(!opts[key]) W.refuse('MISSING_ARGUMENT',`--${key} is required`); return opts[key];};
const identifier=()=>W.recordId(opts.id??randomUUID());
function child(script, extra) {
  const r=spawnSync(process.execPath,[path.join(W.engineRoot,'factory/scripts',script),'--project',opts.project,'--workspace',opts.workspace??process.env.MV_WORKSPACE_ROOT,...extra],
    {windowsHide:true,encoding:'utf8',maxBuffer:64*1024*1024,timeout:30*60*1000});
  if(r.status!==0) {
    // The render CLI refuses with exit 3 and a structured browser diagnostic
    // before any expensive work when no usable browser is available.
    const err=String(r.stderr??'');
    if(r.status===3 && /BROWSER_(MISSING|EXECUTABLE_INVALID|VERSION_UNSUPPORTED|PROVISIONING_NOT_AUTHORIZED)/.test(err)) {
      W.refuse('BROWSER_NOT_READY',`${script} exit=${r.status}: ${err.slice(-4000)}`);
    }
    W.refuse('RENDER_FAILED',`${script} exit=${r.status} signal=${r.signal}: ${err.slice(-6000)}`);
  }
  return r;
}
function compare(w) {
  const read=(value)=> /^\d+$/.test(value) ? w.read(W.revisionPath('storyboard',W.positiveRevision(value))) : w.read(`preproduction/workflow/previews/${W.recordId(value)}.json`);
  const a=read(needed('from')),b=read(needed('to'));
  if(!a||!b) W.refuse('MISSING_COMPARISON','Both revisions or preview ids must exist in this project');
  if(a.chapters&&b.chapters) {
    const old=W.shotsOf(a),next=W.shotsOf(b);
    return {from:a.revision,to:b.revision,changed:next.filter((s)=>W.hash(s)!==W.hash(old.find((t)=>t.id===s.id)??null)).map((s)=>({id:s.id,before:old.find((t)=>t.id===s.id)??null,after:s})),removed:old.filter((s)=>!next.some((t)=>t.id===s.id)).map((s)=>s.id),unchanged:next.filter((s)=>W.hash(s)===W.hash(old.find((t)=>t.id===s.id)??null)).map((s)=>s.id)};
  }
  return {from:a,to:b,sameOutput:a.output?.sha256===b.output?.sha256,sameSource:a.binding?.fingerprint===b.binding?.fingerprint};
}
function run() {
  if(!command||['help','--help'].includes(command)) return {help:'mv:workflow -- <command> --project ID [--workspace ROOT]',
    commands:['status','next','shots','inspect-shot','preview-shot','edit-shot','approve-revision','review-shot','review-section','review-timeline','review-render','compare','render-readiness','review-package'],
    selection:'Default: active approved storyboard. --revision N --draft explicitly selects a draft. --frames A:B uses half-open output frames.',
    preview:'preview-shot --shot ID (or --frames A:B) --profile ci|master [--id ID] [--out NAME.mp4]',
    edit:'edit-shot --revision N --new-revision N --shot ID --patch project-relative.json; a patch contains only editable shot fields. Timing must retain explicit approved boundary evidence.',
    review:'review-shot --shot ID --preview ID --decision accept|request-changes|reject|not-reviewed [--notes TEXT] [--synthetic]; timeline/section acceptance requires a preview covering that entire scope.',
    approve:'approve-revision --revision N --notes TEXT; explicit technical promotion is separate from artistic acceptance',
    compare:'compare --from REVISION_OR_PREVIEW_ID --to REVISION_OR_PREVIEW_ID',exitCodes:{0:'success',2:'refused/invalid',3:'status/readiness blocked'}};
  parse(); needed('project');
  if(opts.draft&&!opts.revision) W.refuse('DRAFT_SELECTION_REQUIRED','--draft requires --revision');
  const w=W.openWorkflow(opts.project,opts.workspace,opts.revision);
  if(['status','next','render-readiness'].includes(command)) {
    const s=W.status(w);
    process.exitCode=s.fullRenderReady?0:3;
    if(command==='next') return {projectId:w.projectId,state:s.state,actions:s.blockers.length?s.blockers:[{code:'PREVIEW_OR_REVIEW',action:'preview-shot; review-shot; review-timeline; mv:produce'}]};
    return s;
  }
  if(command==='compare') return compare(w);
  const selected=W.selection(w,{draft:Boolean(opts.draft)||command==='approve-revision'});
  const shots=W.shotsOf(selected.board);
  const shot=opts.shot?shots.find((s)=>s.id===opts.shot):null;
  if(opts.shot&&!shot) W.refuse('SHOT_MISSING',`Unknown shot ${opts.shot}; use shots to list valid ids`);
  if(command==='shots') return {revision:w.raw.revision,status:w.raw.status,chapters:selected.board.chapters};
  if(command==='inspect-shot') {needed('shot'); return {revision:w.raw.revision,status:w.raw.status,shot,requirements:selected.board.assetRequirements.filter((r)=>shot.assetRequirementIds.includes(r.id)),continuity:selected.continuity?.entries.filter((e)=>shot.continuityIds.includes(e.id))??[],reviews:W.status(w).reviews.filter((r)=>r.shotId===shot.id)};}
  if(command==='edit-shot') {
    needed('shot'); const next=W.positiveRevision(needed('new-revision'));
    if(next<=w.raw.revision) W.refuse('REVISION_COLLISION','New revision must be greater than its parent');
    const target=W.revisionPath('storyboard',next);
    if(w.read(target)) W.refuse('REVISION_COLLISION',`Revision ${next} already exists`);
    const changeId=identifier();
    if(w.read(`preproduction/workflow/changes/${changeId}.json`)) W.refuse('RECORD_COLLISION','Choose a new change record id');
    const patch=w.read(needed('patch'));
    const allowed=['startFrame','endFrame','renderer','rendererParams','purpose','visualDescription','camera','movement','colorAndLighting','environmentReference','timingRationale','continuityIds','media','assetAssignments'];
    if(!patch||!Object.keys(patch).length||Object.keys(patch).some((k)=>!allowed.includes(k))) W.refuse('INVALID_PATCH',`Allowed fields: ${allowed.join(', ')}`);
    const draft=structuredClone(w.raw); draft.revision=next; draft.status='draft';
    const edited=W.shotsOf(draft).find((s)=>s.id===shot.id);
    const {assetAssignments,...shotPatch}=patch; Object.assign(edited,shotPatch);
    if(assetAssignments) {
      if(typeof assetAssignments!=='object'||Array.isArray(assetAssignments)) W.refuse('INVALID_ASSIGNMENT','assetAssignments must map requirement id to approved project asset id');
      for(const [reqId,assetId] of Object.entries(assetAssignments)) {
        const req=draft.assetRequirements.find((r)=>r.id===reqId&&edited.assetRequirementIds.includes(r.id));
        const asset=w.project.config.assets.find((a)=>a.id===assetId&&a.approval==='approved');
        if(!req||req.shotIds.length!==1||!asset||req.kind!==asset.kind) W.refuse('ASSET_ASSIGNMENT_INVALID','Assignment needs a requirement owned only by this shot and a compatible approved project asset');
        if(selected.intake?.records.some((r)=>r.requirementId===reqId)) W.refuse('USE_ASSET_HANDOFF','This requirement has reviewed intake; replace it through preproduction attach-asset and review-asset, then create a new storyboard revision');
        req.status='approved';req.fulfilledAssetId=assetId;
      }
    }
    if(patch.startFrame!==undefined&&patch.startFrame!==shot.startFrame) {
      const approvedFrames=new Set([...(selected.annotations.beatAnchors??[]),...(selected.annotations.cutCues??[])].filter((e)=>e.approval==='approved').map((e)=>e.frame));
      if(!approvedFrames.has(edited.startFrame)) W.refuse('TIMING_EVIDENCE_REQUIRED','Changed start needs an approved manual anchor/cut; resolve adjacent shots explicitly');
      edited.timingSource='manual-cut'; edited.sourceFrame=edited.startFrame;
    }
    for(const r of draft.assetRequirements.filter((r)=>r.shotIds.includes(shot.id))) {
      r.renderer=edited.renderer;
      if(r.durationFrames!==null) r.durationFrames=edited.endFrame-edited.startFrame;
      r.fingerprint=requirementFingerprint(r);
    }
    const proposed={...w,raw:draft};
    validatePlan({...draft,source:{...w.read(W.P.plan).source,...draft.source}},w.project,selected.annotations,selected.lyrics);
    const validated=W.selection(proposed,{draft:true});
    // Missing assets may be revised, but incompatible renderers/parameters may not.
    if(validated.board.renderReady) W.candidate(proposed,validated);
    W.writeProjectJson(w.boundary,target,draft);
    W.append(w,'changes',{id:changeId,projectId:w.projectId,parentRevision:w.raw.revision,revision:next,shotId:shot.id,patch,status:'proposed',timestamp:new Date().toISOString()});
    return {status:'draft',revision:next,path:target,changed:[shot.id],activeRevision:w.read(W.P.storyboard)?.revision};
  }
  if(command==='approve-revision') {
    needed('revision');needed('notes');
    if(w.raw.status!=='draft') W.refuse('REVISION_NOT_DRAFT','Only a draft can be promoted');
    W.checkedCandidate(w,selected,`preproduction/workflow/candidates/promotion-r${w.raw.revision}.json`);
    const active=w.read(W.P.storyboard);
    if(active?.revision>=w.raw.revision) W.refuse('REVISION_COLLISION','Cannot replace an equal or newer active revision');
    if(active?.status==='approved') {
      const snapshot=`preproduction/workflow/approved-storyboards/r${active.revision}.json`;
      const existing=w.read(snapshot);
      if(existing&&W.hash(existing)!==W.hash(active)) W.refuse('REVISION_COLLISION','Historical approved storyboard snapshot differs');
      if(!existing) W.writeProjectJson(w.boundary,snapshot,active);
    }
    // Keep the original draft bytes in revisions; active approval is separate evidence.
    const approved={...w.raw,status:'approved'};
    W.append(w,'approvals',{id:identifier(),revision:w.raw.revision,projectId:w.projectId,binding:W.binding(w,selected),notes:opts.notes,timestamp:new Date().toISOString(),synthetic:Boolean(opts.synthetic)});
    W.writeProjectJson(w.boundary,W.P.storyboard,approved);
    return {revision:approved.revision,status:'approved',artisticApproval:false};
  }
  if(command==='preview-shot') {
    if(Boolean(opts.shot)===Boolean(opts.frames)) W.refuse('INVALID_RANGE','Select exactly one --shot or --frames A:B');
    const [start,end]=shot?[shot.startFrame,shot.endFrame]:needed('frames').split(':').map(Number);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>w.project.durationInFrames||(!shot&&!/^\d+:\d+$/.test(opts.frames))) W.refuse('INVALID_RANGE','Use half-open range A:B inside the project duration');
    const profile=opts.profile??'ci'; if(!['ci','master'].includes(profile)) W.refuse('INVALID_PROFILE','Use ci or master');
    const id=identifier();
    if(w.read(`preproduction/workflow/previews/${id}.json`)) W.refuse('RECORD_COLLISION','Choose a new preview id');
    const output=W.resolveRenderOutputPath(w.boundary,{mode:'video',projectId:w.projectId,requested:opts.out??`preview-r${w.raw.revision}-${id}.mp4`});
    if(path.extname(output).toLowerCase()!=='.mp4') W.refuse('INVALID_OUTPUT','Preview must be MP4');
    if(existsSync(output)) W.refuse('OUTPUT_EXISTS','Preview cannot overwrite an existing output or master');
    const bound=W.binding(w,selected), cfg=W.candidate(w,selected);
    if(profile==='ci'&&cfg.output.width>640) {
      cfg.output.width=Math.round(cfg.output.width/4)*2;cfg.output.height=Math.round(cfg.output.height/4)*2;
      if(cfg.visual.pixel) {cfg.visual.pixel.internalWidth=Math.max(8,Math.round(cfg.visual.pixel.internalWidth/2));cfg.visual.pixel.internalHeight=Math.max(8,Math.round(cfg.visual.pixel.internalHeight/2));}
    }
    const configPath=`preproduction/workflow/candidates/${id}.json`;
    W.writeProjectJson(w.boundary,configPath,cfg);
    W.loadProject(w.projectId,{workspaceRoot:w.workspaceRoot,engineRoot:W.engineRoot,configPath});
    child('render-project.mjs',['--config',configPath,'--mode','video','--frames',`${start}-${end-1}`,'--out',path.basename(output)]);
    const render=w.read(`reports/render-${w.projectId}-video.json`);
    const mixPath=w.file(`cache/audio-mix/${w.projectId}-mix.wav`);
    if(W.hash(readFileSync(mixPath))!==render.audioMix.sha256) W.refuse('MIX_HASH_CHANGED','The rendered mix changed before preview inspection');
    const qc=inspectPreview(output,{width:cfg.output.width,height:cfg.output.height,fps:cfg.output.fps,start,end,mixPath,sampleRate:render.audioMix.sampleRate});
    const refreshed=W.openWorkflow(w.projectId,w.workspaceRoot,opts.revision);
    if(W.binding(refreshed,W.selection(refreshed,{draft:Boolean(opts.draft)})).fingerprint!==bound.fingerprint) W.refuse('SOURCE_CHANGED_DURING_PREVIEW','Inputs changed while rendering; preview cannot be recorded as current');
    return W.append(w,'previews',{schemaVersion:1,id,projectId:w.projectId,revision:w.raw.revision,approvalAtRender:w.raw.status,shotId:shot?.id??null,range:[start,end],profile,binding:bound,configPath,configSha256:W.hash(cfg),output:{path:`renders/${path.basename(output)}`,sha256:W.hash(readFileSync(output))},qc,timestamp:new Date().toISOString(),artisticApproval:false});
  }
  if(command.startsWith('review-')&&command!=='review-package') {
    const scopes={'review-shot':'shot','review-section':'section','review-timeline':'timeline','review-render':'render'};
    const scope=scopes[command];if(!scope) W.refuse('UNKNOWN_COMMAND',command);
    const decision=needed('decision');if(!['accept','request-changes','reject','not-reviewed'].includes(decision)) W.refuse('INVALID_DECISION','Use accept, request-changes, reject or not-reviewed');
    if(['reject','request-changes'].includes(decision)&&!opts.notes?.trim()) W.refuse('REVIEW_NOTES_REQUIRED','Rejection/change requests require notes');
    const section=scope==='section'?selected.annotations.sections.find((s)=>s.id===needed('section')):null;
    if(scope==='section'&&!section) W.refuse('SECTION_MISSING','Unknown section');
    if(scope==='shot') needed('shot');
    const range=scope==='shot'?[shot.startFrame,shot.endFrame]:section?[section.startFrame,section.endFrame]:[0,w.project.durationInFrames];
    let p=opts.preview?W.currentPreview(w,selected,opts.preview):null;
    if(!p&&(scope==='render'||opts.profile)) {
      const profile=opts.profile??'master'; if(!['ci','master'].includes(profile)) W.refuse('INVALID_PROFILE','Use ci or master');
      const e=w.read(`reports/production-evidence${profile==='ci'?'-ci':''}.json`);
      const b=W.binding(w,selected);
      if(!e||e.workflowBinding?.fingerprint!==b.fingerprint||W.hash(readFileSync(w.file(e.output.path)))!==e.output.sha256) W.refuse('STALE_RENDER','Render is absent or stale');
      const r=w.read(`reports/render-${w.projectId}-video.json`);
      inspectPreview(w.file(e.output.path),{width:e.output.video.width,height:e.output.video.height,fps:w.project.config.output.fps,start:0,end:w.project.durationInFrames,mixPath:w.file(`cache/audio-mix/${w.projectId}-mix.wav`),sampleRate:r.audioMix.sampleRate});
      p={id:null,range:[0,w.project.durationInFrames],binding:b,output:e.output};
    }
    if(decision==='accept'&&(!p||p.range[0]>range[0]||p.range[1]<range[1])) W.refuse('REVIEW_SCOPE_UNCOVERED','Acceptance requires a current preview covering the entire review scope');
    if(scope==='render'&&!p) W.refuse('PREVIEW_REQUIRED','Select a verified output using --preview');
    let dimensions={};if(opts.dimensions) dimensions=JSON.parse(opts.dimensions);
    const allowed=['continuity','composition','timing','narrative','style','assets','transitions','avAlignment','overall'];
    if(!dimensions||typeof dimensions!=='object'||Array.isArray(dimensions)||Object.entries(dimensions).some(([k,v])=>!allowed.includes(k)||typeof v!=='string')) W.refuse('INVALID_DIMENSIONS','Review dimensions must map supported names to text');
    return W.append(w,'reviews',{schemaVersion:1,id:identifier(),projectId:w.projectId,revision:w.raw.revision,scope,shotId:shot?.id??null,sectionId:section?.id??null,range,decision,notes:opts.notes??'',dimensions,binding:W.binding(w,selected),previewId:p?.id??null,output:p?.output??null,timestamp:new Date().toISOString(),synthetic:Boolean(opts.synthetic),reviewerIdentity:'not-authenticated'});
  }
  if(command==='review-package') {
    const s=W.status(w), id=identifier(), relative=`reports/workflow-review/${id}`;
    if(existsSync(w.file(`${relative}/review.json`,false))) W.refuse('RECORD_COLLISION','Review package already exists');
    const dir=W.ensureSafeDirectory(w.boundary,path.join(w.project.projectDir,relative),'project');
    const previews=s.previews.filter((p)=>p.current);
    const master=s.outputs.find((o)=>o.current);
    if(!previews.length&&!master) W.refuse('PREVIEW_REQUIRED','Render a current preview or full master before building a decoded contact sheet');
    const images=[];
    const samples=master ? shots.map((shot)=>({shotId:shot.id,output:master.output,frame:shot.startFrame,range:[shot.startFrame,shot.endFrame]})) : previews.map((p)=>({...p,frame:0}));
    for(const [index,p] of samples.entries()) {
      const output=w.file(p.output.path), name=`decoded-${index}.png`;
      const dest=W.assertSafePath(w.boundary,path.join(dir,name),{expect:'file'});
      runMedia('ffmpeg',['-v','error','-ss',String(p.frame/w.project.config.output.fps),'-i',output,'-frames:v','1','-vf','scale=320:-2',dest]);
      images.push({preview:p.id??null,shotId:p.shotId??null,source:p.output,sourceFrame:p.frame,path:name,sha256:W.hash(readFileSync(dest)),range:p.range});
    }
    const sheet=W.assertSafePath(w.boundary,path.join(dir,'contact-sheet.png'),{expect:'file'});
    runMedia('ffmpeg',['-v','error','-framerate','1','-i',path.join(dir,'decoded-%d.png'),'-vf',`tile=4x${Math.ceil(images.length/4)}`,'-frames:v','1',sheet]);
    const revisionDir=W.assertSafePath(w.boundary,path.join(w.project.projectDir,'preproduction/revisions'),{expect:'dir'});
    const prior=existsSync(revisionDir)?readdirSync(revisionDir).filter((n)=>/^storyboard-r\d+\.json$/.test(n)).map((n)=>w.read(`preproduction/revisions/${n}`)).filter((b)=>b.revision!==w.raw.revision):[];
    const revisionComparisons=prior.map((b)=>({revision:b.revision,currentRevision:w.raw.revision,shots:W.shotsOf(b),changedShotIds:shots.filter((shot)=>W.hash(shot)!==W.hash(W.shotsOf(b).find((old)=>old.id===shot.id)??null)).map((shot)=>shot.id)}));
    const report={...s,concept:selected.brief,sections:selected.annotations.sections,rendererDistribution:shots.reduce((a,s)=>(a[s.renderer]=(a[s.renderer]??0)+1,a),{}),decodedStills:images,contactSheet:'contact-sheet.png',revisionComparisons,finalReviewDecision:'NOT REVIEWED',humanArtisticApproval:false};
    W.writeProjectJson(w.boundary,`${relative}/review.json`,report);
    const markdown=`# Local MV review: ${w.projectId}\n\nArtistic decision: **NOT REVIEWED**. Automated technical acceptance is not human artistic approval.\n\n${selected.brief.concept??''}\n\n![Decoded contact sheet](contact-sheet.png)\n\n## Shot timeline\n\n| Shot | Frames [start,end) | Renderer |\n|---|---|---|\n${shots.map((s)=>`| ${s.id} | ${s.startFrame}:${s.endFrame} | ${s.renderer} |`).join('\n')}\n\n## Preview videos\n\n${previews.map((p)=>`- [${p.id}](../../../${p.output.path}) — ${p.range.join(':')}`).join('\n')}\n\n## Review and pending work\n\nFull details, sections, continuity, asset states, technical QC, history, changes and revision comparisons: [review.json](review.json).\n\nFinal decision: [ ] Accept [ ] Request changes [ ] Reject\nNotes:\n`;
    writeFileSync(W.assertSafePath(w.boundary,path.join(dir,'REVIEW.md'),{expect:'file'}),markdown);
    return {path:`${relative}/REVIEW.md`,contactSheet:`${relative}/contact-sheet.png`,previews:previews.length,decodedStills:images.length,artisticApproval:false};
  }
  W.refuse('UNKNOWN_COMMAND',`Unknown command ${command}; use help`);
}
try { console.log(JSON.stringify(run(),null,2)); }
catch(e) { console.error(JSON.stringify({status:'REFUSED',code:e.code??'PROJECT_INPUT_INVALID',message:e.message},null,2));process.exitCode=2; }

// Mandatory offline acceptance. Reuses both complete synthetic baselines;
// creative iteration runs in a fresh copy, preserving their accepted masters.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as W from './support/workflow-state.mjs';
import {inspectPreview, runMedia} from './support/workflow-media.mjs';
const require=createRequire(import.meta.url);
const {createWriteBoundary}=require('../dist/src/workspace/writeBoundary.js');
const args=process.argv.slice(2), root=args.includes('--workspace')?args[args.indexOf('--workspace')+1]:process.env.MV_WORKSPACE_ROOT;
const runId=W.recordId(args.includes('--run-id')?args[args.indexOf('--run-id')+1]:'workflow');
if(!root) throw new Error('MV_WORKSPACE_ROOT required; no repository fallback');
const results=[];
function check(name, fn) { try {const evidence=fn();results.push({name,pass:true,evidence}); console.log(JSON.stringify(results.at(-1)));return evidence;} catch(e){results.push({name,pass:false,error:e.message});console.error(JSON.stringify(results.at(-1))); throw e;} }
function cli(project, command, extra=[], workspace=root, expected=0) {
  const r=spawnSync(process.execPath,[path.join(W.engineRoot,'factory/scripts/mv-workflow.mjs'),command,'--project',project,'--workspace',workspace,...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:20*60*1000});
  assert.equal(r.status,expected,`${command}: ${r.stderr}`);
  return JSON.parse(expected===2?r.stderr:r.stdout);
}
const A='synthetic-mv-signal-garden', B='prism-transit-demo';
const a=W.openWorkflow(A,root), b=W.openWorkflow(B,root);
const originals=[a,b].map((w)=>({w,project:W.hash(readFileSync(w.file('project.json'))),board:W.hash(w.raw),sources:W.binding(w,W.selection(w)).sources,
  master:w.read('reports/production-evidence-ci.json').output}));
for(const w of [a,b]) {
  check(`${w.projectId}: independent status and pending human review`,()=>{const s=cli(w.projectId,'status');assert(s.fullRenderReady);assert.equal(s.artisticStatus,'AWAITING_CREATIVE_REVIEW');return {state:s.state,shots:s.shotCount};});
  const shots=W.shotsOf(w.raw), early=shots[0], middle=shots[Math.floor(shots.length/2)], rangeShot=shots[1];
  check(`${w.projectId}: shot inspection`,()=>{assert.equal(cli(w.projectId,'inspect-shot',['--shot',middle.id]).shot.id,middle.id);});
  check(`${w.projectId}: actual timeline inspection`,()=>assert.equal(cli(w.projectId,'shots').chapters.flatMap((c)=>c.shots).length,shots.length));
  for(const [id,s] of [['early',early],['middle',middle]]) check(`${w.projectId}: real ${id} shot preview`,()=>cli(w.projectId,'preview-shot',['--shot',s.id,'--id',`${runId}-baseline-${id}`]));
  check(`${w.projectId}: bounded nonzero range with decoded soundtrack`,()=>{const p=cli(w.projectId,'preview-shot',['--frames',`${rangeShot.startFrame+3}:${rangeShot.startFrame+27}`,'--id',`${runId}-nonzero`]);assert.equal(p.qc.video.decodedFrames,24);assert(p.qc.audio.correlation>.95);assert(p.qc.audio.referenceRms>0.0001,'Sync evidence must contain audible PCM, not only silence');return p;});
  check(`${w.projectId}: decoded review package`,()=>{const r=cli(w.projectId,'review-package',['--id',`${runId}-baseline`]);assert(readFileSync(w.file(r.contactSheet)).length>100);return r;});
}
// A second, fresh synthetic workspace for a bounded rerender investigation.
const iterationRoot=path.join(b.project.workspaceRoot,`workflow-iteration-${runId}`), projectDir=path.join(iterationRoot,B);
if(existsSync(iterationRoot)) throw new Error('Use a fresh workflow verification workspace');
mkdirSync(iterationRoot);
mkdirSync(projectDir);
const copyBoundary=createWriteBoundary({projectDir,engineRoot:W.engineRoot});
function copyTree(src,relative='') {
  for(const e of readdirSync(src,{withFileTypes:true})) {
    if(!relative&&['cache','renders','reports'].includes(e.name)) continue;
    if(relative==='preproduction'&&e.name==='workflow') continue;
    const rel=path.join(relative,e.name), dest=W.assertSafePath(copyBoundary,path.join(projectDir,rel),{expect:e.isDirectory()?'dir':'file'});
    if(e.isSymbolicLink()) throw new Error('No links in synthetic baseline');
    if(e.isDirectory()) {W.ensureSafeDirectory(copyBoundary,dest,'project');copyTree(path.join(src,e.name),rel);}
    else copyFileSync(path.join(src,e.name),dest);
  }
}
copyTree(b.project.projectDir);
let w=W.openWorkflow(B,iterationRoot), base=w.raw.revision;
const target=W.shotsOf(w.raw).find((s)=>s.renderer==='pixel-canvas'&&!s.assetRequirementIds.length)??W.shotsOf(w.raw).find((s)=>s.renderer==='pixel-canvas');
const local=(command,extra=[],exit=0)=>cli(B,command,extra,iterationRoot,exit);
const patch=(name,value)=>{W.writeProjectJson(w.boundary,`preproduction/workflow/patches/${name}.json`,value);return `preproduction/workflow/patches/${name}.json`;};
const edit=(n,value)=>local('edit-shot',['--shot',target.id,'--new-revision',String(n),'--patch',patch(`edit-${n}`,value)]);
const before=check('Original nonuniform shot preview',()=>local('preview-shot',['--shot',target.id,'--id','before']));
check('Targeted draft revision preserves approved history',()=>{edit(base+1,{purpose:'Synthetic test: composition correction requested',rendererParams:{...target.rendererParams,background:'#241542'}});assert.equal(W.hash(w.read(W.P.storyboard)),W.hash(w.raw));});
const draft=['--revision',String(base+1),'--draft'];
const after=check('Draft renders affected shot only',()=>local('preview-shot',[...draft,'--shot',target.id,'--id','after']));
check('Changed output is visible and unrelated shots unchanged',()=>{assert.notEqual(before.output.sha256,after.output.sha256);const c=local('compare',['--from',String(base),'--to',String(base+1)]);assert.deepEqual(c.changed.map((s)=>s.id),[target.id]);assert.equal(c.unchanged.length,W.shotsOf(w.raw).length-1);return c;});
for(const decision of ['reject','request-changes']) check(`Synthetic ${decision} persists`,()=>local('review-shot',[...draft,'--shot',target.id,'--preview','after','--decision',decision,'--notes','Synthetic test action: adjust composition','--synthetic']));
check('Old preview cannot approve changed frames',()=>{assert.equal(local('review-shot',[...draft,'--shot',target.id,'--preview','before','--decision','accept','--synthetic'],2).code,'STALE_PREVIEW');});
check('Synthetic acceptance remains separate from artistic approval',()=>{local('review-shot',[...draft,'--shot',target.id,'--preview','after','--decision','accept','--synthetic']);});
check('Approved correction is a separate explicit promotion',()=>local('approve-revision',['--revision',String(base+1),'--notes','Synthetic test promotion after correction','--synthetic']));
check('Current revision comparison and review package',()=>local('review-package',['--id','corrected']));
check('Earlier artistic review becomes stale after a further edit',()=>{
  const now=W.openWorkflow(B,iterationRoot);w=now;
  edit(base+2,{visualDescription:'Synthetic test: second proposed intent'});
  const s=local('status',['--revision',String(base+2)],3);
  assert(s.reviews.every((r)=>!r.current));
  assert.equal(local('review-shot',['--revision',String(base+2),'--draft','--shot',target.id,'--preview','after','--decision','accept','--synthetic'],2).code,'STALE_PREVIEW');
});
function negative(name,command,extra,code) {check(name,()=>{const r=local(command,extra,2);if(code)assert.equal(r.code,code);return r;});}
check('Invalid project id',()=>assert.equal(cli('../bad','status',[],iterationRoot,2).status,'REFUSED'));
negative('Missing shot','inspect-shot',['--shot','missing'],'SHOT_MISSING');
negative('Invalid range','preview-shot',['--frames','20:2'],'INVALID_RANGE');
negative('Cross-project output','preview-shot',['--shot',target.id,'--out',path.join(root,A,'renders','escape.mp4')]);
negative('Existing master/preview overwrite','preview-shot',['--shot',target.id,'--out',path.basename(after.output.path)],'OUTPUT_EXISTS');
negative('Negative review requires notes','review-shot',['--shot',target.id,'--decision','reject'],'REVIEW_NOTES_REQUIRED');
negative('Timeline acceptance needs full scope','review-timeline',['--preview','after','--decision','accept','--synthetic'],'REVIEW_SCOPE_UNCOVERED');
negative('Revision collision','edit-shot',['--shot',target.id,'--new-revision',String(base+1),'--patch',patch('collision',{purpose:'test'})],'REVISION_COLLISION');
negative('Timeline overlap','edit-shot',['--shot',target.id,'--new-revision',String(base+3),'--patch',patch('overlap',{endFrame:target.endFrame+1})]);
negative('Incompatible draft renderer','edit-shot',['--shot',target.id,'--new-revision',String(base+3),'--patch',patch('renderer',{renderer:'unknown'})]);
const videoShot=W.shotsOf(w.raw).find((s)=>s.media?.kind==='video');
negative('Wrong media in-point','edit-shot',['--shot',videoShot.id,'--new-revision',String(base+3),'--patch',patch('inpoint',{media:{...videoShot.media,sourceStartFrames:999999}})]);
// Mutations below affect only this new synthetic clone and are always restored.
function mutate(relative,bytes,fn) {const targetPath=w.file(relative), old=readFileSync(targetPath);writeFileSync(W.assertSafePath({...w.boundary,sourcePaths:[]},targetPath,{expect:'file'}),bytes);try{fn();}finally{writeFileSync(W.assertSafePath({...w.boundary,sourcePaths:[]},targetPath,{expect:'file'}),old);}}
check('Missing soundtrack and changed source hash fail closed',()=>{mutate(w.project.config.audio.path,Buffer.from('synthetic corrupt audio'),()=>{assert.equal(local('status',[],2).status,'REFUSED');});});
check('Missing soundtrack leaves approved outputs untouched',()=>{
  const cfg=structuredClone(w.project.config);cfg.audio.path='source/audio/missing.wav';cfg.assets.find((a)=>a.id===cfg.audio.assetId).path=cfg.audio.path;
  mutate('project.json',JSON.stringify(cfg),()=>assert.equal(local('status',[],2).status,'REFUSED'));
});
check('Unapproved storyboard cannot silently preview',()=>{mutate(W.P.storyboard,JSON.stringify({...w.raw,status:'draft'}),()=>{negative('Draft needs explicit selection','preview-shot',['--shot',target.id],'STORYBOARD_UNAPPROVED');});});
check('Unapproved module is refused',()=>{const cfg=structuredClone(w.project.config);cfg.sceneModules[0].trust='pending';mutate('project.json',JSON.stringify(cfg),()=>{assert.equal(local('status',[],2).status,'REFUSED');});});
check('Unapproved intake blocks preview',()=>{const intake=w.read(W.P.assetIntake);intake.records[0].review='pending';mutate(W.P.assetIntake,JSON.stringify(intake),()=>{assert.equal(local('preview-shot',['--shot',target.id],2).code,'ASSETS_UNFULFILLED');});});
check('Junction output escape leaves outside directory untouched',()=>{const outside=path.join(iterationRoot,'outside');mkdirSync(outside);const link=path.join(projectDir,'renders','linked');symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');try{negative('Linked destination','preview-shot',['--shot',target.id,'--out',path.join(link,'escape.mp4')]);assert.deepEqual(readdirSync(outside),[]);}finally{unlinkSync(link);}});
check('Unauthorized provider operation is absent',()=>negative('No generation command','generation',[],'UNKNOWN_COMMAND'));
check('Decoded verification refuses missing frames/audio',()=>{
  const temp=W.assertSafePath(w.boundary,path.join(projectDir,'renders','no-audio.mp4'),{expect:'file',subtree:'renders'});
  runMedia('ffmpeg',['-v','error','-i',w.file(after.output.path),'-an','-c:v','copy',temp]);
  const spec={width:after.qc.video.width,height:after.qc.video.height,fps:w.project.config.output.fps,start:after.range[0],end:after.range[1],mixPath:w.file(`cache/audio-mix/${B}-mix.wav`),sampleRate:after.qc.audio.sampleRate};
  assert.throws(()=>inspectPreview(temp,spec),/AAC/);
  assert.throws(()=>inspectPreview(w.file(after.output.path),{...spec,end:spec.end+1}),/frame count/);
});
check('Complete corrected MV plus explicit rerender in fresh workspace',()=>{
  const runs=[];
  for(const extra of [[],[],['--rerender']]) {
    const r=spawnSync(process.execPath,[path.join(W.engineRoot,'factory/scripts/produce-mv.mjs'),'--project',B,'--workspace',iterationRoot,'--profile','ci',...extra],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:20*60*1000});
    W.writeProjectJson(w.boundary,`reports/workflow-production-${runs.length}.json`,{exit:r.status,stderr:r.stderr,stdout:r.stdout});
    assert.equal(r.status,0,r.stderr);runs.push({exit:r.status,idempotent:r.stderr.includes('ALREADY_COMPLETE')});
  }
  assert(runs[1].idempotent);
  const e=w.read('reports/production-evidence-ci.json');
  const qc=inspectPreview(w.file(e.output.path),{width:e.output.video.width,height:e.output.video.height,fps:w.project.config.output.fps,start:0,end:w.project.durationInFrames,mixPath:w.file(`cache/audio-mix/${B}-mix.wav`),sampleRate:48000});
  assert.equal(e.storyboard.revision,base+1);
  const originalMaster=b.file(originals.find((o)=>o.w.projectId===B).master.path);
  const decodedUnchanged=[];
  for(const shot of W.shotsOf(w.raw).filter((s)=>s.id!==target.id)) {
    const frame=Math.floor((shot.startFrame+shot.endFrame)/2);
    const decode=(file)=>runMedia('ffmpeg',['-v','error','-ss',String(frame/w.project.config.output.fps),'-i',file,'-frames:v','1','-vf','scale=32:32','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
    const old=decode(originalMaster),fresh=decode(w.file(e.output.path));
    assert.equal(old.length,3072);assert.equal(fresh.length,old.length);
    const difference=old.reduce((sum,v,i)=>sum+Math.abs(v-fresh[i]),0)/old.length;
    assert(difference<2,`Unrelated shot ${shot.id} changed: decoded mean difference ${difference}`);
    decodedUnchanged.push({shotId:shot.id,frame,meanAbsolutePixelDifference:difference});
  }
  return {runs,qc,decodedUnchanged,attempts:w.read('reports/render-attempts-ci.json')};
});
check('Failed retry cannot fabricate a success manifest',()=>{
  const evidence=w.read('reports/production-evidence-ci.json');
  const r=spawnSync(process.execPath,[path.join(W.engineRoot,'factory/scripts/produce-mv.mjs'),'--project',B,'--workspace',iterationRoot,'--profile','ci','--rerender','--retry','2'],{env:{...process.env,REMOTION_BROWSER_EXECUTABLE:path.join(projectDir,'absent-browser.exe')},encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:10*60*1000});
  assert.notEqual(r.status,0);assert.equal(W.hash(w.read('reports/production-evidence-ci.json')),W.hash(evidence));
  const d=w.read('reports/render-attempts-ci.json');assert.equal(d.attempts.length,2);assert(d.attempts.every((a)=>a.exit!==0&&a.sourceHashesUnchanged));
  assert.equal(W.hash(readFileSync(w.file(evidence.output.path))),evidence.output.sha256);
  return {exit:r.status,attempts:d.attempts};
});
check('Synthetic section, timeline and render reviews use the complete decoded master',()=>{
  local('review-render',['--profile','ci','--decision','accept','--synthetic']);
  local('review-section',['--section',w.read(W.P.annotations).sections[0].id,'--profile','ci','--decision','accept','--synthetic']);
  local('review-timeline',['--profile','ci','--decision','accept','--synthetic']);
  const s=local('status');assert.equal(s.artisticStatus,'AWAITING_CREATIVE_REVIEW');assert(s.changes.some((c)=>c.status==='approved'));
  return local('review-package',['--id','final-master']);
});
check('Original approved masters, inputs and sources remain immutable',()=>{for(const o of originals){assert.equal(W.hash(readFileSync(o.w.file('project.json'))),o.project);assert.equal(W.hash(o.w.read(W.P.storyboard)),o.board);assert.equal(W.hash(readFileSync(o.w.file(o.master.path))),o.master.sha256);for(const s of o.sources)assert.equal(W.hash(readFileSync(o.w.file(s.path))),s.sha256);}});
W.writeProjectJson(w.boundary,'reports/workflow-verification.json',{results,syntheticReviews:true,humanArtisticApproval:false,providerSubmissions:0});
console.log(JSON.stringify({verdict:'PASS',checks:results.length,evidence:`workflow-iteration-${runId}/prism-transit-demo/reports/workflow-verification.json`,note:'AUTOMATED TECHNICAL ACCEPTANCE IS NOT HUMAN ARTISTIC APPROVAL'}));

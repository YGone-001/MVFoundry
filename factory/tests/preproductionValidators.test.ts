import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {PreproductionError} from '../src/errors';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {
  parseLrcLyrics,
  validateAnnotations,
  validateCreativeBrief,
  validateJsonLyrics,
} from '../src/preproduction/validate';
import type {PreproductionContext} from '../src/preproduction/validate';
import {REPO_ROOT} from './helpers';

const template = (projectId: string, name: string): Record<string, any> =>
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'preproduction-projects', projectId, name),
      'utf8',
    ),
  ) as Record<string, any>;

const contextFor = (
  projectId: string,
  width: number,
  height: number,
  assets: any[] = [],
): PreproductionContext => ({
  projectId,
  fps: projectId === 'synthetic-lyrics-demo' ? 24 : 30,
  durationInFrames: projectId === 'synthetic-lyrics-demo' ? 96 : 120,
  width,
  height,
  assets,
  rendererKinds: new Set(DEFAULT_SCENE_REGISTRY.kinds()),
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('annotations enforce half-open ranges, approval and coverage', () => {
  const context = contextFor('synthetic-beat-demo', 640, 360);
  const annotations = validateAnnotations(
    template('synthetic-beat-demo', 'annotations.template.json'),
    context,
    {requireApproved: true, requireCoverage: true},
  );
  assert.equal(annotations.bpm?.value, 120);
  assert.equal(annotations.sections.length, 3);
  assert.equal(annotations.sections[0].startFrame, 0);
  assert.equal(annotations.sections[2].endFrame, 120);

  const overlap = template('synthetic-beat-demo', 'annotations.template.json');
  overlap.sections[1].startFrame = 20;
  assert.throws(
    () => validateAnnotations(overlap, context, {requireCoverage: true}),
    PreproductionError,
  );

  const gap = template('synthetic-beat-demo', 'annotations.template.json');
  gap.sections[1].startFrame = 31;
  assert.throws(
    () => validateAnnotations(gap, context, {requireCoverage: true}),
    /gap or overlap/,
  );

  const outOfRange = template('synthetic-beat-demo', 'annotations.template.json');
  outOfRange.sections[2].endFrame = 121;
  assert.throws(() => validateAnnotations(outOfRange, context), /duration/);

  const unapproved = template('synthetic-beat-demo', 'annotations.template.json');
  unapproved.sections[0].approval = 'draft';
  assert.throws(
    () => validateAnnotations(unapproved, context, {requireApproved: true}),
    /must all be approved/,
  );

  const duplicatedCut = template('synthetic-beat-demo', 'annotations.template.json');
  duplicatedCut.cutCues[1].frame = duplicatedCut.cutCues[0].frame;
  duplicatedCut.cutCues[1].timeSeconds = duplicatedCut.cutCues[0].timeSeconds;
  assert.throws(() => validateAnnotations(duplicatedCut, context), /strictly increasing/);
});

test('creative briefs are style-independent but must match the project profile', () => {
  const beat = contextFor('synthetic-beat-demo', 640, 360);
  const brief = validateCreativeBrief(
    template('synthetic-beat-demo', 'creative-brief.template.json'),
    beat,
  );
  assert.equal(brief.visualStyle, 'pixel-art');
  assert.equal(brief.aspectRatio, '16:9');
  assert.equal(brief.preferredRenderers[0], 'pixel-canvas');
  assert.ok(brief.assumptions.length > 0);

  const uncertain = contextFor('synthetic-uncertain-demo', 540, 960);
  const uncertainBrief = validateCreativeBrief(
    template('synthetic-uncertain-demo', 'creative-brief.template.json'),
    uncertain,
  );
  assert.equal(uncertainBrief.aspectRatio, '9:16');
  assert.equal(uncertainBrief.visualStyle, 'abstract motion graphics');

  const mismatch = template('synthetic-beat-demo', 'creative-brief.template.json');
  mismatch.aspectRatio = '9:16';
  assert.throws(() => validateCreativeBrief(mismatch, beat), /does not match/);

  const unknownRenderer = template('synthetic-beat-demo', 'creative-brief.template.json');
  unknownRenderer.preferredRenderers = ['not-a-renderer'];
  assert.throws(() => validateCreativeBrief(unknownRenderer, beat), /unregistered renderer/);

  const unknownReference = template('synthetic-beat-demo', 'creative-brief.template.json');
  unknownReference.approvedReferences = ['MISSING'];
  assert.throws(() => validateCreativeBrief(unknownReference, beat), /unknown asset/);
});

test('section labels and lyric languages remain user-defined', () => {
  const labels = template('synthetic-beat-demo', 'annotations.template.json');
  labels.sections[1].label = 'pre-chorus';
  const context = contextFor('synthetic-beat-demo', 640, 360);
  const validated = validateAnnotations(labels, context, {requireCoverage: true});
  assert.equal(validated.sections[1].label, 'pre-chorus');

  const lyricsContext = { ...contextFor('synthetic-lyrics-demo', 720, 540), sections: validateAnnotations(
    template('synthetic-lyrics-demo', 'annotations.template.json'),
    contextFor('synthetic-lyrics-demo', 720, 540),
    {requireCoverage: true},
  ).sections };
  const lrc = parseLrcLyrics({
    text: '[00:00.50]Un signal se réveille\n',
    language: 'fr',
    sourcePath: 'preproduction/lyrics.lrc',
    sourceSha256: 'c'.repeat(64),
    approval: 'approved',
    context: lyricsContext,
  });
  assert.equal(lrc.language, 'fr');
  assert.equal(lrc.lines[0].text, 'Un signal se réveille');
});

test('LRC lyrics preserve UTF-8 text, timestamps and frame mapping', () => {
  const annotations = validateAnnotations(
    template('synthetic-lyrics-demo', 'annotations.template.json'),
    contextFor('synthetic-lyrics-demo', 720, 540),
    {requireCoverage: true},
  );
  const context = contextFor('synthetic-lyrics-demo', 720, 540);
  context.sections = annotations.sections;
  const lyrics = parseLrcLyrics({
    text: '\uFEFF[ti:Synthetic]\n[00:00.50]A signal wakes\n[00:01.25]A borrowed light \u00e9\n',
    language: 'en',
    sourcePath: 'preproduction/lyrics.lrc',
    sourceSha256: 'a'.repeat(64),
    approval: 'approved',
    context,
  });
  assert.equal(lyrics.format, 'lrc');
  assert.equal(lyrics.lines.length, 2);
  assert.equal(lyrics.lines[0].frame, 12);
  assert.equal(lyrics.lines[1].frame, 30);
  assert.equal(lyrics.lines[1].text, 'A borrowed light \u00e9');
  assert.throws(
    () =>
      parseLrcLyrics({
        text: '[00:01.00]duplicate\n[00:01.00]again\n',
        language: 'en',
        sourcePath: 'preproduction/lyrics.lrc',
        sourceSha256: 'a'.repeat(64),
        approval: 'approved',
        context,
      }),
    /strictly increasing/,
  );
  assert.throws(
    () =>
      parseLrcLyrics({
        text: 'plain text without a timestamp\n',
        language: 'en',
        sourcePath: 'preproduction/lyrics.lrc',
        sourceSha256: 'a'.repeat(64),
        approval: 'approved',
        context,
      }),
    /no timestamp/,
  );
});

test('structured lyrics validate section references and frame boundaries', () => {
  const annotations = validateAnnotations(
    template('synthetic-lyrics-demo', 'annotations.template.json'),
    contextFor('synthetic-lyrics-demo', 720, 540),
    {requireCoverage: true},
  );
  const context = contextFor('synthetic-lyrics-demo', 720, 540);
  context.sections = annotations.sections;
  const lyrics = validateJsonLyrics({
    raw: template('synthetic-lyrics-demo', 'lyrics.template.json'),
    language: 'en',
    sourcePath: 'preproduction/lyrics.json',
    sourceSha256: 'b'.repeat(64),
    context,
  });
  assert.equal(lyrics.lines.length, 4);
  assert.equal(lyrics.lines[0].id, 'LYRIC-001');
  assert.equal(lyrics.lines[0].frame, 12);
  assert.equal(lyrics.lines[0].sectionId, 'SEC-01');
  assert.equal(lyrics.lines[3].sectionId, 'SEC-03');

  const invalidSection = template('synthetic-lyrics-demo', 'lyrics.template.json');
  invalidSection.lines[0].sectionId = 'MISSING';
  assert.throws(
    () =>
      validateJsonLyrics({
        raw: invalidSection,
        language: 'en',
        sourcePath: 'preproduction/lyrics.json',
        sourceSha256: 'b'.repeat(64),
        context,
      }),
    /unknown section/,
  );

  const outOfRange = clone(template('synthetic-lyrics-demo', 'lyrics.template.json'));
  outOfRange.lines[0].timeSeconds = 5;
  assert.throws(
    () =>
      validateJsonLyrics({
        raw: outOfRange,
        language: 'en',
        sourcePath: 'preproduction/lyrics.json',
        sourceSha256: 'b'.repeat(64),
        context,
      }),
    /duration/,
  );
});
import assert from 'node:assert/strict';
import test from 'node:test';
import {PreproductionError} from '../src/errors';
import {
  assertRendererAllowedByProject,
  assertRendererAllowedByStyle,
  styleCompatibilityForProject,
} from '../src/preproduction/styleCompatibility';

const projectFor = (styleId: string | null, modules: Array<{id: string; styleIds?: string[]}> = []): any => ({
  config: {
    visual: styleId ? {style: {id: styleId}} : {},
  },
  sceneModules: modules,
});

test('legacy projects without a style keep every renderer available', () => {
  const project = projectFor(null, [{id: 'legacy', styleIds: undefined}]);
  assert.doesNotThrow(() => assertRendererAllowedByProject(project, 'layered-canvas', 'shot'));
  assert.doesNotThrow(() => assertRendererAllowedByProject(project, 'pixel-canvas', 'shot'));
  assert.doesNotThrow(() => assertRendererAllowedByProject(project, 'video', 'shot'));
  assert.deepEqual(styleCompatibilityForProject(project), {});
});

test('a selected style allows only its declared module and media routes', () => {
  const project = projectFor('cinematic-illustration-2p5d', [
    {id: 'style-module', styleIds: ['cinematic-illustration-2p5d']},
    {id: 'other-module', styleIds: ['retro-pixel']},
  ]);
  const context = styleCompatibilityForProject(project);
  assert.equal(context.styleId, 'cinematic-illustration-2p5d');
  assert.deepEqual([...(context.styleModuleIds ?? [])], ['style-module']);

  assert.doesNotThrow(() => assertRendererAllowedByStyle(context, 'project:style-module', 'shot'));
  assert.doesNotThrow(() => assertRendererAllowedByStyle(context, 'video', 'shot'));
  assert.doesNotThrow(() => assertRendererAllowedByStyle(context, 'hybrid', 'shot'));
  assert.doesNotThrow(() => assertRendererAllowedByStyle(context, 'parallax-2p5d', 'shot'));

  assert.throws(
    () => assertRendererAllowedByStyle(context, 'project:other-module', 'shot'),
    /does not declare visual style cinematic-illustration-2p5d/,
  );
  assert.throws(
    () => assertRendererAllowedByStyle(context, 'project:missing-module', 'shot'),
    /does not declare visual style cinematic-illustration-2p5d/,
  );
  assert.throws(
    () => assertRendererAllowedByStyle(context, 'layered-canvas', 'shot'),
    /is not allowed by visual style/,
  );
});

test('media-route absence fails closed per style', () => {
  const retro = {styleId: 'retro-pixel', styleModuleIds: new Set<string>()};
  assert.throws(
    () => assertRendererAllowedByStyle(retro, 'video', 'shot'),
    /style retro-pixel does not declare; declared media routes: none/,
  );
  assert.throws(
    () => assertRendererAllowedByStyle(retro, 'parallax-2p5d', 'shot'),
    /does not declare/,
  );

  const ink = {styleId: 'ink-watercolor', styleModuleIds: new Set<string>()};
  assert.doesNotThrow(() => assertRendererAllowedByStyle(ink, 'parallax-2p5d', 'shot'));
  assert.doesNotThrow(() => assertRendererAllowedByStyle(ink, 'video', 'shot'));

  const diorama = {styleId: 'stylized-3d-diorama', styleModuleIds: new Set<string>()};
  assert.throws(
    () => assertRendererAllowedByStyle(diorama, 'parallax-2p5d', 'shot'),
    /does not declare/,
  );
  assert.doesNotThrow(() => assertRendererAllowedByStyle(diorama, 'video', 'shot'));
});

test('unregistered style ids fail rather than falling back', () => {
  assert.throws(
    () => assertRendererAllowedByStyle({styleId: 'unknown-style'}, 'video', 'shot'),
    PreproductionError,
  );
  assert.throws(
    () => assertRendererAllowedByStyle({styleId: 'unknown-style'}, 'video', 'shot'),
    /is not registered/,
  );
});
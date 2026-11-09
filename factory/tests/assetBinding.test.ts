import assert from 'node:assert/strict';
import test from 'node:test';
import {requirementSupportsRenderer} from '../src/preproduction/assetBinding';

test('2.5D intake accepts the plate and layer kinds the planned path produces', () => {
  assert.equal(requirementSupportsRenderer('image', 'parallax-2p5d'), true);
  assert.equal(requirementSupportsRenderer('layer', 'parallax-2p5d'), true);
});

test('2.5D intake refuses kinds the planned path does not produce', () => {
  assert.equal(requirementSupportsRenderer('video', 'parallax-2p5d'), false);
  assert.equal(requirementSupportsRenderer('scene-module', 'parallax-2p5d'), false);
  assert.equal(requirementSupportsRenderer('existing-asset', 'parallax-2p5d'), false);
});

test('existing renderer binding rules are unchanged', () => {
  assert.equal(requirementSupportsRenderer('image', 'layered-canvas'), true);
  assert.equal(requirementSupportsRenderer('layer', 'layered-canvas'), false);
  assert.equal(requirementSupportsRenderer('video', 'video'), true);
  assert.equal(requirementSupportsRenderer('layer', 'video'), false);
  assert.equal(requirementSupportsRenderer('image', 'video'), false);
  assert.equal(requirementSupportsRenderer('video', 'hybrid'), true);
  assert.equal(requirementSupportsRenderer('layer', 'hybrid'), true);
  assert.equal(requirementSupportsRenderer('image', 'hybrid'), false);
});

test('unknown renderers are refused instead of inferring a binding', () => {
  for (const renderer of ['pixel-canvas', 'project:scene', 'svg', 'html', 'three', '']) {
    assert.equal(requirementSupportsRenderer('image', renderer), false, renderer);
    assert.equal(requirementSupportsRenderer('layer', renderer), false, renderer);
    assert.equal(requirementSupportsRenderer('video', renderer), false, renderer);
  }
});
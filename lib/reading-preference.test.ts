import assert from 'node:assert/strict';
import test from 'node:test';
import { prefersMulti } from '../src/scripts/reading-preference.ts';

test('saved mode selects single or multi explicitly', () => {
  assert.equal(prefersMulti('single'), false);
  assert.equal(prefersMulti('multi'), true);
});

test('missing or invalid preferences default to single', () => {
  assert.equal(prefersMulti(null), false);
  assert.equal(prefersMulti('unexpected'), false);
  assert.equal(prefersMulti(''), false);
});

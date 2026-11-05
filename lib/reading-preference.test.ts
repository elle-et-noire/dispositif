import assert from 'node:assert/strict';
import test from 'node:test';
import { prefersMulti } from '../src/scripts/reading-preference.ts';

test('saved mode takes precedence over the first-visit width heuristic', () => {
  assert.equal(prefersMulti('single', 2000, 600), false);
  assert.equal(prefersMulti('multi', 320, 350), true);
  assert.equal(prefersMulti(null, 1199, 600), false);
  assert.equal(prefersMulti(null, 1200, 600), true);
  assert.equal(prefersMulti('unexpected', 1200, 600), true);
});

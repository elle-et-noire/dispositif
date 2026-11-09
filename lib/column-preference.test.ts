import assert from 'node:assert/strict';
import test from 'node:test';
import { opensMulti, prefersMulti, urlColumnMode } from '../src/scripts/column-preference.ts';

test('a saved choice selects single or multi explicitly', () => {
  assert.equal(prefersMulti('single'), false);
  assert.equal(prefersMulti('multi'), true);
});

test('missing or invalid preferences default to single', () => {
  assert.equal(prefersMulti(null), false);
  assert.equal(prefersMulti('unexpected'), false);
  assert.equal(prefersMulti(''), false);
});

test('the columns parameter names a column layout only with a valid value', () => {
  assert.equal(urlColumnMode('?columns=multi'), 'multi');
  assert.equal(urlColumnMode('?columns=single'), 'single');
  assert.equal(urlColumnMode('?a=1&columns=multi'), 'multi');
  assert.equal(urlColumnMode(''), undefined);
  assert.equal(urlColumnMode('?columns='), undefined);
  assert.equal(urlColumnMode('?columns=MULTI'), undefined);
  assert.equal(urlColumnMode('?mode=multi'), undefined);
});

test('a column layout in the URL wins over the stored preference', () => {
  assert.equal(opensMulti('?columns=multi', 'single'), true);
  assert.equal(opensMulti('?columns=multi', null), true);
  assert.equal(opensMulti('?columns=single', 'multi'), false);
});

test('without a valid column layout in the URL the stored preference applies', () => {
  assert.equal(opensMulti('', 'multi'), true);
  assert.equal(opensMulti('?columns=other', 'multi'), true);
  assert.equal(opensMulti('', null), false);
});

test('a history entry opened by URL keeps the column layout the reader left it in', () => {
  assert.equal(opensMulti('?columns=multi', 'single', 'single'), false);
  assert.equal(opensMulti('?columns=single', 'multi', 'multi'), true);
  assert.equal(opensMulti('?columns=multi', 'single', 'multi'), true);
  // Entries without a column layout in the URL follow the preference, as before.
  assert.equal(opensMulti('', 'multi', 'single'), true);
});

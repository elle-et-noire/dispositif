import assert from 'node:assert/strict';
import test from 'node:test';
import { opensMulti, prefersMulti, urlReadingMode } from '../src/scripts/reading-preference.ts';

test('saved mode selects single or multi explicitly', () => {
  assert.equal(prefersMulti('single'), false);
  assert.equal(prefersMulti('multi'), true);
});

test('missing or invalid preferences default to single', () => {
  assert.equal(prefersMulti(null), false);
  assert.equal(prefersMulti('unexpected'), false);
  assert.equal(prefersMulti(''), false);
});

test('the view parameter names a mode only with a valid value', () => {
  assert.equal(urlReadingMode('?view=multi'), 'multi');
  assert.equal(urlReadingMode('?view=single'), 'single');
  assert.equal(urlReadingMode('?a=1&view=multi'), 'multi');
  assert.equal(urlReadingMode(''), undefined);
  assert.equal(urlReadingMode('?view='), undefined);
  assert.equal(urlReadingMode('?view=MULTI'), undefined);
  assert.equal(urlReadingMode('?mode=multi'), undefined);
});

test('a mode in the URL wins over the stored preference', () => {
  assert.equal(opensMulti('?view=multi', 'single'), true);
  assert.equal(opensMulti('?view=multi', null), true);
  assert.equal(opensMulti('?view=single', 'multi'), false);
});

test('without a valid mode in the URL the stored preference applies', () => {
  assert.equal(opensMulti('', 'multi'), true);
  assert.equal(opensMulti('?view=other', 'multi'), true);
  assert.equal(opensMulti('', null), false);
});

test('a history entry opened by URL keeps the mode the reader left it in', () => {
  assert.equal(opensMulti('?view=multi', 'single', 'single'), false);
  assert.equal(opensMulti('?view=single', 'multi', 'multi'), true);
  assert.equal(opensMulti('?view=multi', 'single', 'multi'), true);
  // Entries without a mode in the URL follow the preference, as before.
  assert.equal(opensMulti('', 'multi', 'single'), true);
});

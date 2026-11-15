const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine.js'); require('../src/journal.js');
const entry = (id, move = 1, text = 'Alice gains lumber') => ({ id, move, text, event: { type: 'gain', player: 'Alice', resources: { lumber: 1 } } });
test('uses move+signature+occurrence when page-local IDs change on refresh', () => {
  const logs = {};
  Caton.mergeLogs(logs, [entry(52, 8), entry(53, 9)], 'page1');
  Caton.mergeLogs(logs, [entry(0, 8), entry(1, 9)], 'page2');
  assert.equal(Object.keys(logs).length, 2);
});
test('identical events within one move count separately', () => {
  const logs = {};
  Caton.mergeLogs(logs, [entry(1), entry(2)], 'page1');
  assert.equal(Object.keys(logs).length, 2);
  Caton.mergeLogs(logs, [entry(0), entry(1)], 'page2');
  assert.equal(Object.keys(logs).length, 2);
});
test('missing move IDs are explicitly treated as page-only', () => {
  const logs = {};
  const result = Caton.mergeLogs(logs, [entry(1, null)], 'page1');
  assert.equal(result.unverified, true);
  assert.equal(Object.values(logs)[0].stable, false);
});
test('partial repeated move is flagged instead of claiming verified history', () => {
  const logs = {};
  Caton.mergeLogs(logs, [entry(1), entry(2)], 'page1');
  assert.equal(Caton.mergeLogs(logs, [entry(0)], 'page2').unverified, true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
require('../src/engine.js'); require('../src/parser.js');
const event = name => Caton.parseLog(new JSDOM(readFileSync(`test/fixtures/bga-${name}.html`, 'utf8')).window.document.querySelector('.log'), ['Alice']);
// Sanitized visible log DOM captured from a finished BGA match.
test('BGA bank wording spends the offered resources and credits both received types', () => {
  assert.deepEqual(event('bank'), { type: 'bank', player: 'Alice', give: { grain: 6 }, receive: { wool: 1, ore: 1 } });
});
test('printed discounted city cost takes precedence over the standard city cost', () => {
  const tracker = new Caton.Tracker(['Alice']);
  tracker.apply({ type: 'set', player: 'Alice', resources: { grain: 2, ore: 2, wool: 1 } });
  assert.equal(tracker.apply(event('discount-city')), true);
  assert.equal(tracker.players.Alice.grain, 1);
  assert.equal(tracker.players.Alice.ore, 0);
  assert.equal(tracker.players.Alice.wool, 1);
  assert.equal(tracker.total('Alice'), 2);
  assert.equal(tracker.warnings.length, 0);
});

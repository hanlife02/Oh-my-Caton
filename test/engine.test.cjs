const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine.js');
const { Tracker } = globalThis.Caton;
const gain = (player, resources) => ({ type: 'gain', player, resources });
function tracker() { return new Tracker(['Alice', 'Bob Smith']); }
test('tracks gains and exact settlement/city/development costs', () => {
  const t = tracker();
  t.apply(gain('Alice', { lumber: 2, brick: 2, wool: 2, grain: 5, ore: 5 }));
  for (const building of ['settlement', 'city', 'development']) t.apply({ type: 'build', player: 'Alice', building });
  assert.deepEqual(t.players.Alice, { lumber: 1, brick: 1, wool: 0, grain: 1, ore: 1, paper: 0, cloth: 0, coin: 0, unknown: 0 });
});
test('hidden theft preserves totals without pretending victim cards are certain', () => {
  const t = tracker();
  t.apply(gain('Alice', { lumber: 2, ore: 1 }));
  t.apply({ type: 'steal', player: 'Bob Smith', victim: 'Alice', resources: { unknown: 1 } });
  assert.deepEqual(t.players.Alice, { lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0, paper: 0, cloth: 0, coin: 0, unknown: 1 });
  assert.equal(t.players['Bob Smith'].unknown, 1);
});
test('single known resource theft is inferred exactly', () => {
  const t = tracker(); t.apply(gain('Alice', { ore: 3 }));
  t.apply({ type: 'steal', player: 'Bob Smith', victim: 'Alice', resources: { unknown: 1 } });
  assert.equal(t.players.Alice.ore, 2); assert.equal(t.players['Bob Smith'].ore, 1);
});
test('known spending consumes uncertainty and never creates negative resources', () => {
  const t = tracker(); t.apply(gain('Alice', { unknown: 2 }));
  assert.equal(t.apply({ type: 'build', player: 'Alice', building: 'road' }), true);
  assert.equal(t.total('Alice'), 0);
});
test('impossible trade is atomic and produces a visible warning', () => {
  const t = tracker(); t.apply(gain('Alice', { ore: 1 }));
  const before = structuredClone(t.players);
  assert.equal(t.apply({ type: 'trade', player: 'Alice', other: 'Bob Smith', give: { ore: 1 }, receive: { grain: 1 } }), false);
  assert.deepEqual(t.players, before); assert.equal(t.warnings.length, 1);
});
test('bank trade and player trade conserve the expected cards', () => {
  const t = tracker(); t.apply(gain('Alice', { lumber: 4 })); t.apply(gain('Bob Smith', { wool: 1 }));
  t.apply({ type: 'bank', player: 'Alice', give: { lumber: 4 }, receive: { ore: 1 } });
  t.apply({ type: 'trade', player: 'Alice', other: 'Bob Smith', give: { ore: 1 }, receive: { wool: 1 } });
  assert.equal(t.players.Alice.wool, 1); assert.equal(t.players['Bob Smith'].ore, 1);
});
test('free building and empty theft do not spend cards', () => {
  const t = tracker();
  assert.equal(t.apply({ type: 'build', player: 'Alice', building: 'road', free: true }), true);
  assert.equal(t.apply({ type: 'steal', player: 'Alice', victim: 'Bob Smith', resources: {} }), true);
  assert.equal(t.warnings.length, 0);
});
test('rejects negative quantities and unknown players without partial mutation', () => {
  const t = tracker();
  assert.equal(t.apply(gain('Alice', { ore: -1 })), false);
  assert.equal(t.apply(gain('Mallory', { ore: 1 })), false);
  assert.equal(t.total('Alice'), 0);
});
test('manual corrections set counts and clear warning for that player', () => {
  const t = tracker(); t.apply({ type: 'build', player: 'Alice', building: 'city' });
  t.apply({ type: 'set', player: 'Alice', resources: { ore: 3, grain: 2 } });
  assert.equal(t.total('Alice'), 5); assert.equal(t.warnings.length, 0);
});

test('correcting one party in a failed trade preserves the other party warning', () => {
  const t = tracker(); t.apply(gain('Alice', { ore: 1 }));
  t.apply({ type: 'trade', player: 'Alice', other: 'Bob Smith', give: { ore: 1 }, receive: { grain: 1 } });
  t.apply({ type: 'set', player: 'Bob Smith', resources: { ore: 1 } });
  assert.equal(t.warnings.length, 1);
  t.apply({ type: 'set', player: 'Alice', resources: { grain: 1 } });
  assert.equal(t.warnings.length, 0);
});
test('an invalidated victim cannot reveal a stolen card or block a known receipt', () => {
  const t = tracker();
  t.apply(gain('Bob Smith', { ore: 1 }));
  t.apply({ type: 'unresolved', player: 'Bob Smith', affected: ['Bob Smith'], message: 'undo' });
  t.apply({ type: 'steal', player: 'Alice', victim: 'Bob Smith', resources: { unknown: 1 } });
  assert.equal(t.players.Alice.ore, 0);
  assert.equal(t.players.Alice.unknown, 1);
  t.apply({ type: 'steal', player: 'Alice', victim: 'Bob Smith', resources: { unknown: 1 } });
  assert.equal(t.total('Alice'), 2);
  assert.ok(t.warnings.every(w => !w.unresolved.includes('Alice')));
});
test('a known trade still updates its reliable party when the other hand is invalidated', () => {
  const t = tracker();
  t.apply(gain('Alice', { lumber: 1 }));
  t.apply({ type: 'unresolved', player: 'Bob Smith', affected: ['Bob Smith'], message: 'undo' });
  assert.equal(t.apply({ type: 'trade', player: 'Alice', other: 'Bob Smith', give: { lumber: 1 }, receive: { ore: 1 } }), true);
  assert.equal(t.players.Alice.lumber, 0);
  assert.equal(t.players.Alice.ore, 1);
  assert.ok(t.warnings.every(w => !w.unresolved.includes('Alice')));
});

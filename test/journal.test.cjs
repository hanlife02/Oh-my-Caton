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

const rollbackTurn = () => [
  { id: 10, move: 130, source: 'Alice built a city', event: { type: 'build', player: 'Alice', building: 'city', resources: { grain: 2, ore: 3 } } },
  { id: 11, move: 131, source: 'Alice built a road', event: { type: 'build', player: 'Alice', building: 'road', resources: { lumber: 1, brick: 1 } } },
  { id: 12, move: 132, source: 'Alice traded with bank', event: { type: 'bank', player: 'Alice', give: { grain: 4 }, receive: { lumber: 1, cloth: 1 } } },
  { id: 13, move: 130, source: 'Alice 回滚操作', event: { type: 'unresolved', player: 'Alice', message: '发生回滚' } },
  { id: 14, move: 130, source: 'Alice取消了他的行动', event: { type: 'unresolved', player: 'Alice', message: '发生回滚' } },
  { id: 15, move: 131, source: 'Alice built a road', event: { type: 'build', player: 'Alice', building: 'road', resources: { lumber: 1, brick: 1 } } },
  { id: 16, move: 132, source: 'Alice built a city', event: { type: 'build', player: 'Alice', building: 'city', resources: { grain: 2, ore: 3 } } },
];
function replayRollback(logs) {
  const tracker = new Caton.Tracker(['Alice', 'Bob']);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 2, brick: 2, grain: 8, ore: 6 } });
  Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
  return tracker;
}
test('rollback removes the entire cancelled suffix while retaining actions that reuse its move IDs', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(0, 3)), 'one');
  Caton.mergeLogs(logs, Caton.prepareLogs(turn), 'one');
  const tracker = replayRollback(logs);
  assert.deepEqual(tracker.warnings, []);
  assert.deepEqual(tracker.players.Alice, { lumber: 1, brick: 1, wool: 0, grain: 6, ore: 3, paper: 0, cloth: 0, coin: 0, unknown: 0 });
});
test('refresh after cancelled logs leave the DOM keeps the replacement road exactly once', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn), 'one');
  const result = Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(5).map((e, id) => ({ ...e, id }))), 'two');
  const tracker = replayRollback(logs);
  assert.equal(result.unverified, false);
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.lumber, 1);
  assert.equal(tracker.players.Alice.grain, 6);
});
test('rollback without its target action remains unresolved', () => {
  const logs = {};
  Caton.mergeLogs(logs, Caton.prepareLogs(rollbackTurn().slice(3, 5)), 'one');
  assert.ok(replayRollback(logs).unresolved('Alice'));
});
test('a later same-page rollback notification cannot reuse an already resolved rollback', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs([turn[0], turn[3], turn[4], turn[5]]), 'one');
  Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(3, 5).map(e => ({ ...e, id: e.id + 20 }))), 'one');
  assert.ok(replayRollback(logs).unresolved('Alice'));
});
test('a new rollback after refresh cancels the active road rather than its old cancelled twin', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(0, 2).concat(turn.slice(3, 6))), 'one');
  Caton.mergeLogs(logs, Caton.prepareLogs([
    { ...turn[5], id: 0 },
    { ...turn[3], id: 1, move: 131 },
    { ...turn[4], id: 2, move: 131 },
  ]), 'two');
  const tracker = replayRollback(logs);
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.lumber, 2);
  assert.equal(tracker.players.Alice.brick, 2);
});
test('a cancelled private notification cannot reveal an active theft', () => {
  const tracker = new Caton.Tracker(['Alice', 'Bob']);
  tracker.apply({ type: 'set', player: 'Bob', resources: { ore: 1, grain: 1 } });
  Caton.replayLogs(tracker, [
    { move: 1, event: { type: 'steal', player: 'Alice', victim: 'Bob', resources: { unknown: 1 } } },
    { move: 1, cancelled: true, event: { type: 'gain', player: 'Alice', resources: { lumber: 1 }, private: true } },
  ], 'Alice');
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.unknown, 1);
});
test('a hand correction attached to a cancelled action cannot overwrite the restored hand', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn), 'one');
  const oldCity = Object.values(logs).find(log => log.id === 10);
  const tracker = new Caton.Tracker(['Alice', 'Bob']);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 2, brick: 2, grain: 8, ore: 6 } });
  const correction = { move: oldCity.move, position: oldCity.position, rank: 1, event: { type: 'set', player: 'Alice', resources: { lumber: 2, brick: 2, grain: 6, ore: 3 } } };
  Caton.replayLogs(tracker, [...Object.values(logs), correction].sort(Caton.compareLogs), 'Alice');
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.grain, 6);
  assert.equal(tracker.players.Alice.ore, 3);
});
test('an empty rollback after a complete preceding notification leaves all hands valid', () => {
  const logs = {};
  const incoming = [
    { id: 96, move: 51, source: 'Bob 弃置了 2 {lumber} 2 {grain}', event: { type: 'loss', player: 'Bob', resources: { lumber: 2, grain: 2 } } },
    { id: 97, move: 51, source: '强盗不会移动，因为野蛮人还没有到达卡坦岛', event: null },
    { id: 98, move: 52, source: 'Alice 回滚操作', event: { type: 'unresolved', player: 'Alice', message: '发生回滚' } },
    { id: 99, move: 52, source: 'Alice取消了他的行动', event: { type: 'unresolved', player: 'Alice', message: '发生回滚' } },
  ];
  Caton.mergeLogs(logs, Caton.prepareLogs(incoming), 'one');
  const tracker = new Caton.Tracker(['Alice', 'Bob']);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 3 } });
  tracker.apply({ type: 'set', player: 'Bob', resources: { lumber: 2, grain: 2, ore: 1 } });
  Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.total('Alice'), 3);
  assert.equal(tracker.total('Bob'), 1);
  const missing = {};
  Caton.mergeLogs(missing, Caton.prepareLogs(incoming.filter(e => e.id !== 97)), 'two');
  assert.ok(replayRollback(missing).unresolved('Alice'));
});

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
test('rollback starting at an unparsed progress card cancels its full suffix before redo', () => {
  const turn = rollbackTurn();
  const logs = {};
  const incoming = [
    { id: 9, move: 129, source: 'Alice 打出了 药物', event: null },
    ...turn.slice(0, 3),
    { ...turn[3], move: 129 }, { ...turn[4], move: 129 },
    ...turn.slice(5),
  ];
  Caton.mergeLogs(logs, Caton.prepareLogs(incoming), 'one');
  const tracker = replayRollback(logs);
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.lumber, 1);
  assert.equal(tracker.players.Alice.grain, 6);
  assert.equal(tracker.players.Alice.ore, 3);
  assert.equal(Object.values(logs).filter(log => log.cancelled).length, 4);
});
test('a rollback still cancels observed actions when its original target has left the DOM', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(0, 3)), 'one');
  Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(3)), 'one');
  const tracker = replayRollback(logs);
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.lumber, 1);
  assert.equal(tracker.players.Alice.grain, 6);
});
test('rollback after refresh separates an identical redo even when the old action is no longer visible', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(0, 2)), 'one');
  Caton.mergeLogs(logs, Caton.prepareLogs([
    { ...turn[3], id: 0, move: 131 },
    { ...turn[4], id: 1, move: 131 },
    { ...turn[5], id: 2 },
  ]), 'two');
  const tracker = replayRollback(logs);
  assert.deepEqual(tracker.warnings, []);
  assert.equal(tracker.players.Alice.lumber, 1);
  assert.equal(Object.values(logs).filter(log => log.event?.building === 'road').length, 2);
});
test('damaged real-match archive repairs the cancelled Medicine branch and remains stable across refresh', () => {
  const journal = structuredClone(require('./fixtures/bga-ck-rollback-171.json'));
  const logs = journal.logs;
  const incoming = Object.values(logs).filter(log => log.observedPage === 'page-5')
    .map(log => ({ id: log.observedId, move: log.move, source: log.source, text: log.text, event: log.event }))
    .sort((a, b) => a.id - b.id);
  const check = () => {
    const tracker = new Caton.Tracker(['Alice', 'Bob', 'Carol']);
    Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
    assert.deepEqual(tracker.warnings, []);
    assert.equal(tracker.total('Alice'), 7);
    assert.equal(tracker.total('Bob'), 7);
    assert.deepEqual(tracker.players.Carol, { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0, paper: 0, cloth: 0, coin: 0, unknown: 1 });
    assert.ok(Object.values(logs).find(log => log.move === 163 && log.event?.type === 'build').cancelled);
  };
  Caton.mergeLogs(logs, Caton.prepareLogs(incoming), 'page-5');
  check();
  const count = Object.keys(logs).length;
  Caton.mergeLogs(logs, Caton.prepareLogs(incoming), 'page-5');
  check();
  Caton.mergeLogs(logs, Caton.prepareLogs(incoming.map((log, id) => ({ ...log, id }))), 'next-refresh');
  check();
  assert.equal(Object.keys(logs).length, count);
});
test('a repeated rollback to a restored checkpoint cancels its replacement branch with a new identity', () => {
  for (const refresh of [false, true]) {
    const logs = {}, turn = rollbackTurn();
    Caton.mergeLogs(logs, Caton.prepareLogs([turn[0], turn[3], turn[4], turn[5]]), 'one');
    const next = refresh ? [turn[5], ...turn.slice(3, 5)] : turn.slice(3, 5);
    Caton.mergeLogs(logs, Caton.prepareLogs(next.map((e, i) => ({ ...e, id: refresh ? i : e.id + 20 }))), refresh ? 'two' : 'one');
    const tracker = replayRollback(logs);
    assert.deepEqual(tracker.warnings, []);
    assert.equal(tracker.players.Alice.lumber, 2);
    assert.equal(tracker.players.Alice.grain, 8);
    assert.equal(Object.values(logs).filter(isUndo => /回滚操作/.test(isUndo.source || '')).length, 2);
  }
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
test('partial history containing an old rollback cannot silently cancel its valid replacement road', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs([turn[0], turn[3], turn[4], turn[5]]), 'one');
  for (let scan = 0; scan < 2; scan++) {
    const result = Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(3, 5).map((log, id) => ({ ...log, id }))), 'two');
    assert.deepEqual(result.ambiguous, ['Alice']);
    assert.equal(result.unverified, true);
    assert.equal(replayRollback(logs).players.Alice.lumber, 1);
    assert.equal(Object.values(logs).filter(log => /回滚操作/.test(log.source || '')).length, 1);
  }
  assert.deepEqual(Caton.mergeLogs(logs, [], 'two').ambiguous, ['Alice'], 'evicting the marker does not resolve ambiguity');
  assert.deepEqual(Caton.mergeLogs(logs, [], 'three').ambiguous, ['Alice'], 'refreshing does not resolve ambiguity');
  const result = Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(3, 6).map((log, id) => ({ ...log, id }))), 'two');
  assert.deepEqual(result.ambiguous, []);
  assert.equal(replayRollback(logs).players.Alice.lumber, 1);
});
test('refresh retaining cancelled identical actions preserves the valid redo and its correction', () => {
  const logs = {}, turn = rollbackTurn();
  Caton.mergeLogs(logs, Caton.prepareLogs(turn), 'one');
  const count = Object.keys(logs).length;
  const road = Object.values(logs).find(log => log.id === 15);
  for (let refresh = 0; refresh < 3; refresh++) {
    const result = Caton.mergeLogs(logs, Caton.prepareLogs(turn.map((log, id) => ({ ...log, id }))), `refresh-${refresh}`);
    assert.deepEqual(result.ambiguous, []);
    assert.equal(Object.keys(logs).length, count);
    assert.equal(logs[road.key].cancelled, undefined);
    assert.equal(replayRollback(logs).players.Alice.lumber, 1);
  }
});
test('ambiguous rollback also invalidates exchange partners, while later corrections still work', () => {
  const logs = {}, turn = rollbackTurn();
  const trade = { id: 15, move: 131, source: 'Alice traded with Bob', event: { type: 'trade', player: 'Alice', other: 'Bob', give: { lumber: 1 }, receive: { ore: 1 } } };
  Caton.mergeLogs(logs, Caton.prepareLogs([turn[0], turn[3], turn[4], trade]), 'one');
  const result = Caton.mergeLogs(logs, Caton.prepareLogs(turn.slice(3, 5).map((log, id) => ({ ...log, id }))), 'two');
  assert.deepEqual(result.ambiguous, ['Alice', 'Bob']);
  const tracker = new Caton.Tracker(['Alice', 'Bob']);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 2, grain: 2, ore: 3 } });
  tracker.apply({ type: 'set', player: 'Bob', resources: { ore: 1 } });
  const correction = { move: 131, position: 1, rank: 1, event: { type: 'set', player: 'Bob', resources: { lumber: 1 } } };
  Caton.replayLogs(tracker, [...Object.values(logs), ...result.ambiguityAnchors, correction].sort(Caton.compareLogs), 'Alice');
  assert.ok(tracker.unresolved('Alice'));
  assert.equal(tracker.unresolved('Bob'), false);
});
test('legacy rollback migration with disconnected page evidence stays unresolved instead of claiming a repaired hand', () => {
  const records = [
    { id: 10, move: 130, position: 1, source: 'Alice 打出了 药物', event: null, observedPage: 'old', observedId: 10 },
    { id: 11, move: 131, position: 1, source: 'Alice built a city', event: { type: 'build', player: 'Alice', building: 'city' }, observedPage: 'middle', observedId: 7 },
    { id: 12, move: 130, position: 2, source: 'Alice 回滚操作', event: { type: 'unresolved', player: 'Alice', message: '发生回滚' }, observedPage: 'new', observedId: 0, rollbackResolved: true },
    { id: 13, move: 130, position: 3, source: 'Alice取消了他的行动', event: { type: 'unresolved', player: 'Alice', message: '发生回滚' }, observedPage: 'new', observedId: 1, rollbackResolved: true },
  ];
  const logs = Object.fromEntries(records.map((log, i) => [String(i), log]));
  Caton.mergeLogs(logs, [], 'new');
  assert.equal(logs['2'].rollbackResolved, false);
  assert.ok(replayRollback(logs).unresolved('Alice'));
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

test('rollback replay matches an independent balance model across 100 seeded action and refresh sequences', () => {
  function runScenario(seed) {
    let state = seed;
    const random = n => { state = (state * 1664525 + 1013904223) >>> 0; return state % n; };
    const logs = {};
    let history = [], move = 1, page = 'initial', id = 1, expected = 100;
    for (let step = 0; step < 30; step++) {
      const active = history.filter(log => !log.cancelled && log.event?.type === 'loss');
      if (random(4) === 0 && active.length) {
        const target = active[random(active.length)].move;
        for (const log of history) {
          if (!log.cancelled && log.move >= target) {
            if (log.event?.type === 'loss') expected++;
            log.cancelled = true;
          }
        }
        history.push({ id: id++, move: target, source: 'Alice 回滚操作', event: { type: 'unresolved', player: 'Alice' } });
        history.push({ id: id++, move: target, source: 'Alice取消了他的行动', event: { type: 'unresolved', player: 'Alice' } });
        move = target + 1;
      } else {
        history.push({ id: id++, move: move++, source: 'Alice spend grain', event: { type: 'loss', player: 'Alice', resources: { grain: 1 } } });
        expected--;
      }
      let incoming;
      if (random(3) === 0) {
        page = `refresh-${step}`;
        incoming = history.filter(log => !log.cancelled).map((log, i) => ({ ...log, id: i }));
        id = incoming.length;
        history = incoming.map(log => ({ ...log }));
      } else incoming = history.map(({ cancelled, ...log }) => log);
      const result = Caton.mergeLogs(logs, Caton.prepareLogs(incoming), page);
      const tracker = new Caton.Tracker(['Alice']);
      tracker.apply({ type: 'set', player: 'Alice', resources: { grain: 100 } });
      Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
      const message = `seed=${seed} step=${step}`;
      assert.equal(tracker.total('Alice'), expected, message);
      assert.equal(tracker.unresolved('Alice'), false, message);
      assert.deepEqual(result.ambiguous, [], message);
    }
  }
  for (let seed = 1; seed <= 100; seed++) runScenario(seed);
});

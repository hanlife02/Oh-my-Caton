const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
require('../src/engine.js'); require('../src/parser.js'); require('../src/journal.js');
const tail = require('./fixtures/bga-ck-tail.json');
const names = ['Alice', 'Bob', 'Carol'];
const parse = id => Caton.parseLog(new JSDOM(`<div>${tail.find(r => r.id === id).html}</div>`).window.document.querySelector('div'), names, 'Alice');
test('live Spy theft and progress-card notifications do not change resource hands', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Alice', resources: { wool: 1, grain: 1 } });
  for (const text of ['Bob 从Alice处偷取一张发展卡', 'Bob steals 1 progress card from Alice',
    'Alice received 1 progress card', 'Alice lost 1 development card']) {
    const event = Caton.parseLog(new JSDOM(`<div>${text}</div>`).window.document.querySelector('div'), names, 'Alice');
    assert.equal(event, null, text);
    if (event) tracker.apply(event);
  }
  assert.equal(tracker.total('Alice'), 2);
  assert.equal(tracker.total('Bob'), 0);
  assert.equal(tracker.players.Alice.unknown, 0);
});
test('saved pre-fix Spy events are ignored even after the original DOM has disappeared', () => {
  const tracker = new Caton.Tracker(names);
  Caton.replayLogs(tracker, [
    { move: 1, event: { type: 'gain', player: 'Alice', resources: { wool: 1, grain: 1 } } },
    { move: 2, source: 'Bob 从Alice处偷取一张发展卡', event: { type: 'steal', player: 'Bob', victim: 'Alice', resources: { unknown: 1 } } },
  ], 'Alice');
  assert.equal(tracker.total('Alice'), 2);
  assert.equal(tracker.total('Bob'), 0);
  assert.equal(tracker.players.Alice.wool, 1);
  assert.equal(tracker.players.Alice.grain, 1);
  assert.equal(tracker.warnings.length, 0);
});
test('mixed production includes paper, and commodity bank trades spend all offered cards', () => {
  assert.deepEqual(parse(201), { type: 'gain', player: 'Alice', resources: { lumber: 2, paper: 1 } });
  assert.deepEqual(parse(4), { type: 'bank', player: 'Carol', give: { ore: 2, paper: 2 }, receive: { lumber: 1, brick: 1 } });
});
test('knight activation, promotion and city walls use their printed resource costs', () => {
  assert.deepEqual(parse(164), { type: 'loss', player: 'Bob', resources: { grain: 1 } });
  assert.deepEqual(parse(166), { type: 'loss', player: 'Bob', resources: { wool: 1, ore: 1 } });
  assert.deepEqual(parse(132), { type: 'loss', player: 'Carol', resources: { brick: 2 } });
  assert.deepEqual(parse(45), { type: 'loss', player: 'Alice', resources: {} });
});
test('science, trade and politics improvements charge commodities by level', () => {
  assert.deepEqual(parse(153), { type: 'improvement', player: 'Alice', resource: 'paper', level: 3 });
  assert.deepEqual(parse(53), { type: 'improvement', player: 'Alice', resource: 'cloth', level: 4 });
  assert.deepEqual(parse(205), { type: 'improvement', player: 'Bob', resource: 'coin', level: 4 });
});
test('prefixed progress-card gains and private losses retain the correct player', () => {
  assert.deepEqual(parse(81), { type: 'gain', player: 'Carol', resources: { grain: 6 } });
  assert.deepEqual(parse(179), { type: 'loss', player: 'Alice', resources: { lumber: 2 }, private: true });
});
test('an unspecified monopoly transfer is not assumed to be a one-card robbery', () => {
  const e = parse(180);
  assert.ok(e); assert.equal(e.type, 'steal'); assert.equal(e.player, 'Carol'); assert.equal(e.victim, 'Alice');
  assert.equal(e.resources, null);
});
test('public Wedding transfers two hidden cards and subsequent spending remains balanced', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Bob', resources: { wool: 1, grain: 1 } });
  tracker.apply({ type: 'set', player: 'Carol', resources: { lumber: 1, brick: 1, grain: 1, ore: 1 } });
  const source = '联姻: Bob 从 Carol 那里偷取资源';
  const event = Caton.parseLog(new JSDOM(`<div>${source}</div>`).window.document.querySelector('div'), names, 'Alice');
  Caton.replayLogs(tracker, [{ move: 1, source, event }], 'Alice');
  assert.equal(tracker.total('Bob'), 4);
  assert.equal(tracker.total('Carol'), 2);
  assert.equal(tracker.players.Carol.unknown, 2);
  assert.equal(tracker.apply({ type: 'build', player: 'Bob', building: 'settlement' }), true);
  assert.equal(tracker.total('Bob'), 0);
  assert.equal(tracker.warnings.length, 0);
});
test('Wedding transfers the only remaining card and also repairs saved unresolved transfers', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Carol', resources: { ore: 1 } });
  Caton.replayLogs(tracker, [{ move: 1, source: 'Wedding: Bob steals from Carol',
    event: { type: 'steal', player: 'Bob', victim: 'Carol', resources: null } }], 'Alice');
  assert.equal(tracker.total('Bob'), 1);
  assert.equal(tracker.players.Bob.ore, 1);
  assert.equal(tracker.total('Carol'), 0);
  assert.equal(tracker.warnings.length, 0);
});
test('free placed roads are recognized without charging the standard road cost', () => {
  assert.deepEqual(parse(99), { type: 'build', player: 'Alice', building: 'road', free: true });
});

test('crane discounts exactly one improvement and expires at the end of a turn', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Alice', resources: { paper: 7, cloth: 4 } });
  const events = [
    { type: 'crane', player: 'Alice' },
    { type: 'improvement', player: 'Alice', resource: 'paper', level: 3 },
    { type: 'improvement', player: 'Alice', resource: 'paper', level: 4 },
    { type: 'crane', player: 'Alice' }, { type: 'turnEnd', player: 'Alice' },
    { type: 'improvement', player: 'Alice', resource: 'cloth', level: 4 },
  ];
  Caton.replayLogs(tracker, events.map((event, i) => ({ move: i + 1, event })), 'Alice');
  assert.equal(tracker.players.Alice.paper, 1);
  assert.equal(tracker.players.Alice.cloth, 0);
  assert.equal(tracker.warnings.length, 0);
});
test('monopoly private loss supplies both the victim debit and thief credit exactly once', () => {
  assert.equal(typeof Caton.prepareLogs, 'function');
  const input = [179, 180].map(id => ({ id, move: tail.find(r => r.id === id).move, event: parse(id), source: `log-${id}` }));
  const logs = {};
  Caton.mergeLogs(logs, Caton.prepareLogs(input), 'one');
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 2 } });
  Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
  assert.equal(tracker.players.Alice.lumber, 0);
  assert.equal(tracker.players.Carol.lumber, 2);
  assert.equal(tracker.warnings.length, 0);
});
test('a late private theft detail replaces the public interpretation without creating another transfer', () => {
  assert.equal(typeof Caton.prepareLogs, 'function');
  const logs = {};
  const publicLog = { id: 2, move: 5, source: 'Bob steals from Alice', event: { type: 'steal', player: 'Bob', victim: 'Alice', resources: { unknown: 1 } } };
  Caton.mergeLogs(logs, Caton.prepareLogs([publicLog]), 'one');
  const privateLog = { id: 1, move: null, source: 'You lost {lumber}', event: { type: 'loss', player: 'Alice', resources: { lumber: 1 }, private: true } };
  Caton.mergeLogs(logs, Caton.prepareLogs([privateLog, publicLog]), 'one');
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 2, ore: 1 } });
  Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
  assert.equal(tracker.total('Alice'), 2);
  assert.equal(tracker.players.Alice.ore, 1);
  assert.equal(tracker.players.Bob.lumber, 1);
  assert.equal(tracker.total('Bob'), 1);
});

test('forced harbor exchange debits and credits each participant once', () => {
  const node = new JSDOM('<div>⇌ 强制交易！Alice 将 <span class="icon_lumber"></span> 给 Bob，后者提供 <span class="icon_paper"></span> 作为交换</div>').window.document.querySelector('div');
  assert.deepEqual(Caton.parseLog(node, names, 'Alice'), { type: 'trade', player: 'Alice', other: 'Bob', give: { lumber: 1 }, receive: { paper: 1 } });
});
test('two private commodity receipts match separate public victims in one notification', () => {
  const input = [
    { id: 1, move: null, event: { type: 'gain', player: 'Alice', resources: { paper: 1 }, private: true } },
    { id: 2, move: null, event: { type: 'gain', player: 'Alice', resources: { paper: 1 }, private: true } },
    { id: 3, move: 5, event: { type: 'steal', player: 'Alice', victim: 'Bob', resources: null } },
    { id: 4, move: 5, event: { type: 'steal', player: 'Alice', victim: 'Carol', resources: null } },
  ];
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Bob', resources: { paper: 1 } });
  tracker.apply({ type: 'set', player: 'Carol', resources: { paper: 1 } });
  Caton.replayLogs(tracker, Caton.prepareLogs(input), 'Alice');
  assert.equal(tracker.players.Alice.paper, 2);
  assert.equal(tracker.total('Bob'), 0); assert.equal(tracker.total('Carol'), 0);
  assert.equal(tracker.warnings.length, 0);
});

test('paired private gain and loss verify a transfer without adding a second debit', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Bob', resources: { paper: 1 } });
  const entries = [
    { id: 1, move: 1, event: { type: 'gain', player: 'Alice', resources: { paper: 1 }, private: true } },
    { id: 2, move: 1, event: { type: 'loss', player: 'Bob', resources: { paper: 1 }, private: true } },
    { id: 3, move: 1, event: { type: 'steal', player: 'Alice', victim: 'Bob', resources: null } },
  ];
  Caton.replayLogs(tracker, Caton.prepareLogs(entries), 'Alice');
  assert.equal(tracker.players.Alice.paper, 1); assert.equal(tracker.total('Bob'), 0);
  assert.equal(tracker.warnings.length, 0);
});

test('the full real-match own-view replay ends with the independently observed seven-card hand', () => {
  const doc = new JSDOM('<body></body>').window.document;
  const incoming = require('./fixtures/bga-ck-match.json').map(row => {
    const node = doc.createElement('div'); node.innerHTML = row.html;
    return { ...row, source: Caton.logText(node), event: Caton.parseLog(node, names, 'Alice') };
  });
  const logs = {}; Caton.mergeLogs(logs, Caton.prepareLogs(incoming), 'one');
  const tracker = new Caton.Tracker(names);
  Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
  // Ground truth: original finished-game hand screenshot, not a calculated expectation.
  assert.deepEqual(tracker.players.Alice, { lumber: 2, brick: 3, wool: 0, grain: 0, ore: 0, paper: 2, cloth: 0, coin: 0, unknown: 0 });
  assert.equal(tracker.total('Alice'), 7);
  assert.ok(tracker.warnings.some(w => w.message.includes('回滚')));
});

test('refresh without private DOM details preserves a previously revealed theft', () => {
  const logs = {};
  const publicLog = { id: 2, move: 5, source: 'Bob steals from Alice', event: { type: 'steal', player: 'Bob', victim: 'Alice', resources: { unknown: 1 } } };
  const privateLog = { id: 1, move: null, source: 'You lost {lumber}', event: { type: 'loss', player: 'Alice', resources: { lumber: 1 }, private: true } };
  Caton.mergeLogs(logs, Caton.prepareLogs([privateLog, publicLog]), 'one');
  Caton.mergeLogs(logs, Caton.prepareLogs([{ ...publicLog, id: 0 }]), 'two');
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Alice', resources: { lumber: 2, ore: 1 } });
  Caton.replayLogs(tracker, Object.values(logs).sort(Caton.compareLogs), 'Alice');
  assert.equal(tracker.players.Alice.ore, 1);
  assert.equal(tracker.players.Bob.lumber, 1);
});

test('a private receipt from a later move never rewrites an earlier theft', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Bob', resources: { paper: 2 } });
  const entries = [
    { id: 1, move: 1, event: { type: 'steal', player: 'Alice', victim: 'Bob', resources: { unknown: 1 } } },
    { id: 2, move: 2, event: { type: 'gain', player: 'Alice', resources: { paper: 1 }, private: true } },
  ];
  Caton.replayLogs(tracker, Caton.prepareLogs(entries), 'Alice');
  assert.equal(tracker.total('Alice'), 2);
});
test('Wedding cannot infer its count from an invalidated victim total', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'unresolved', player: 'Bob', affected: ['Bob'], message: 'undo' });
  Caton.replayLogs(tracker, [{ move: 1, source: 'Wedding: Alice steals from Bob', event: { type: 'steal', player: 'Alice', victim: 'Bob', resources: null } }], 'Alice');
  assert.ok(tracker.warnings.some(w => w.unresolved.includes('Alice')));
});
test('rollback only invalidates the actor and observed exchange partners in that turn', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Alice', resources: { paper: 1 } });
  tracker.apply({ type: 'set', player: 'Bob', resources: { ore: 2 } });
  Caton.replayLogs(tracker, [
    { move: 1, source: 'Carol steals from Bob', event: { type: 'steal', player: 'Carol', victim: 'Bob', resources: { unknown: 1 } } },
    { move: 2, source: 'Carol 回滚操作', event: { type: 'unresolved', player: 'Carol', affected: names, message: '发生回滚' } },
    { move: 2, source: 'Carol取消了他的行动', event: { type: 'unresolved', player: 'Carol', affected: names, message: '发生回滚' } },
  ], 'Alice');
  assert.equal(tracker.warnings.length, 1);
  assert.deepEqual([...tracker.warnings[0].unresolved].sort(), ['Bob', 'Carol']);
  assert.equal(tracker.players.Alice.paper, 1);
});
test('undoing a free initial placement before anyone received cards does not invalidate hands', () => {
  const tracker = new Caton.Tracker(names);
  Caton.replayLogs(tracker, [
    { move: 1, event: { type: 'build', player: 'Carol', building: 'settlement', free: true } },
    { move: 1, source: 'Carol 回滚操作', event: { type: 'unresolved', player: 'Carol', affected: names, message: '发生回滚' } },
    { move: 1, source: 'Carol取消了他的行动', event: { type: 'unresolved', player: 'Carol', affected: names, message: '发生回滚' } },
    { move: 2, event: { type: 'gain', player: 'Carol', resources: { grain: 1 } } },
  ], 'Alice');
  assert.equal(tracker.warnings.length, 0);
  assert.equal(tracker.players.Carol.grain, 1);
});
test('cancelling a same-move Diplomat with no resource actions preserves resource tracking', () => {
  const tracker = new Caton.Tracker(names);
  tracker.apply({ type: 'set', player: 'Carol', resources: { ore: 2, grain: 1 } });
  const cancelled = [
    { move: 108, source: 'Carol 打出了 外交官', event: null },
    { move: 108, source: 'Carol 回滚操作', event: { type: 'unresolved', player: 'Carol', affected: names, message: '发生回滚' } },
    { move: 108, source: 'Carol取消了他的行动', event: { type: 'unresolved', player: 'Carol', affected: names, message: '发生回滚' } },
  ];
  Caton.replayLogs(tracker, cancelled, 'Alice');
  assert.equal(tracker.warnings.length, 0);
  assert.equal(tracker.total('Carol'), 3);
  const charged = new Caton.Tracker(names);
  charged.apply({ type: 'set', player: 'Carol', resources: { lumber: 1, brick: 1 } });
  Caton.replayLogs(charged, [cancelled[0], { move: 108, event: { type: 'build', player: 'Carol', building: 'road', free: false } }, ...cancelled.slice(1)], 'Alice');
  assert.ok(charged.unresolved('Carol'));
});

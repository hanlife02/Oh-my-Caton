const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
require('../src/engine.js'); require('../src/parser.js');
const names = ['Alice', 'Bob Smith'];
const icon = r => `<span class="cat_log_token icon_${r}"></span>`;
const group = s => `<span style="white-space: nowrap">${s}</span>`;
const parse = html => globalThis.Caton.parseLog(new JSDOM(`<div id="log_1" class="log"><div class="roundedbox">${html}</div></div>`).window.document.querySelector('.log'), names);
test('parses nested BGA resource icons, multipliers and Chinese gains', () => {
  assert.deepEqual(parse(`Alice 获得 ${group(`2 ${icon('lumber')} ${icon('ore')}`)}`), { type: 'gain', player: 'Alice', resources: { lumber: 2, ore: 1 } });
});
test('development card purchase cannot accidentally trigger gain handler', () => {
  assert.deepEqual(parse('Alice 买了一张发展卡'), { type: 'build', player: 'Alice', building: 'development', free: false });
});
test('parses cities, roads and settlements in Chinese and English', () => {
  assert.equal(parse('Alice 升级为城市').building, 'city');
  assert.equal(parse('Alice built a road').building, 'road');
  assert.equal(parse('Alice 造了一个村庄').building, 'settlement');
});
test('bank trade parses spending and receiving once', () => {
  assert.deepEqual(parse(`Alice 和银行交易 ${group(`4 ${icon('lumber')}`)} 获得 ${group(icon('ore'))}`), { type: 'bank', player: 'Alice', give: { lumber: 4 }, receive: { ore: 1 } });
});
test('player names containing spaces remain intact in trades and theft', () => {
  assert.deepEqual(parse(`Alice 交给 Bob Smith ${group(icon('ore'))} 并收到 ${group(icon('grain'))}`), { type: 'trade', player: 'Alice', other: 'Bob Smith', give: { ore: 1 }, receive: { grain: 1 } });
  assert.deepEqual(parse('Alice 从 Bob Smith 处偷取了 1 张资源卡'), { type: 'steal', player: 'Alice', victim: 'Bob Smith', resources: { unknown: 1 } });
});
test('normal BGA player exchange markers and canonical text preserve both sides of the trade', () => {
  assert.deepEqual(parse(`⇌ Alice 交给 Bob Smith ${icon('lumber')} 并收到 ${icon('wool')} 作为交换`),
    { type: 'trade', player: 'Alice', other: 'Bob Smith', give: { lumber: 1 }, receive: { wool: 1 } });
  assert.deepEqual(parse('Alice 用资源进行交易: 2 {lumber} → {ore}'),
    { type: 'bank', player: 'Alice', give: { lumber: 2 }, receive: { ore: 1 } });
});
test('failed theft and dice messages are ignored', () => {
  assert.equal(parse('Alice 没有偷取到资源'), null);
  assert.equal(parse('Alice stole nothing from Bob Smith'), null);
  assert.equal(parse('Alice rolled 7'), null);
});
test('starting placements and free roads cost nothing', () => {
  assert.equal(parse('Alice placed a settlement').free, true);
  assert.equal(parse('Alice 免费造了一条路').free, true);
});
test('unknown discards use the printed card count', () => {
  assert.deepEqual(parse('Bob Smith discarded 4 resource cards'), { type: 'loss', player: 'Bob Smith', resources: { unknown: 4 } });
});
test('card effect prefixes do not hide the player resource action', () => {
  assert.deepEqual(parse(`破坏者 : Alice 丢弃 3 ${icon('brick')}`), { type: 'loss', player: 'Alice', resources: { brick: 3 } });
  assert.deepEqual(parse(`Saboteur: Bob Smith discarded 2 ${icon('lumber')}`), { type: 'loss', player: 'Bob Smith', resources: { lumber: 2 } });
  assert.deepEqual(parse(`Card effect: Alice 获得 ${icon('ore')}`), { type: 'gain', player: 'Alice', resources: { ore: 1 } });
  assert.equal(parse(`Alice 提出一个交易请求: Bob Smith 获得 ${icon('ore')}`), null);
});
test('gain wording in a username does not shadow the action', () => {
  const node = new JSDOM('<div>获得Alice 买了一张发展卡</div>').window.document.querySelector('div');
  assert.equal(globalThis.Caton.parseLog(node, ['获得Alice']).type, 'build');
});

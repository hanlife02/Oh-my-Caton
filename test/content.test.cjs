const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const scripts = ['engine', 'parser', 'journal', 'panel', 'content'];
const pause = () => new Promise(r => setTimeout(r, 350));
async function page(saved = {}, logs = '', names = ['Alice', 'Bob Smith'], showSelf = true) {
  const boards = names.map((name, i) => `<div class="player-board ${i ? '' : 'current-player-board current'}"><div class="player-name"><a>${name}</a></div></div>`).join('');
  const dom = new JSDOM(`<div id="player_boards">${boards}</div><div id="logs">${logs}</div>`, { url: 'https://boardgamearena.com/1/catan?table=42', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.structuredClone = structuredClone;
  dom.window.chrome = {
    storage: { local: { async get(key) { return structuredClone({ [key]: saved[key] }); }, async set(value) { Object.assign(saved, structuredClone(value)); } } },
    runtime: { onMessage: { addListener() {} } },
  };
  for (const script of scripts) {
    dom.window.eval(readFileSync(`src/${script}.js`, 'utf8'));
    // Resource regression fixtures inspect the tracked self hand as well.
    if (script === 'panel' && showSelf) {
      const render = dom.window.Caton.Panel.prototype.render;
      dom.window.Caton.Panel.prototype.render = function (state) { return render.call(this, { ...state, hideSelf: false }); };
    }
  }
  await pause();
  return { dom, saved, panel: dom.window.document.querySelector('#oh-my-caton').shadowRoot };
}
const gainLog = (id, n = 1) => `<div class="log" id="log_${id}" data-move-id="${id}"><div class="roundedbox">Alice 获得 <span style="white-space: nowrap">${n} <span class="cat_log_token icon_lumber"></span></span></div></div>`;
test('upgrade recovers saved prefixed discards missing from the current DOM without duplicating private details', async () => {
  const saved = { 'caton:table:42:rules:3': { corrections: [], logs: {
    gain: { id: 1, move: 1, position: 1, stable: true, source: 'Alice 获得 2 {lumber} 6 {brick}', event: { type: 'gain', player: 'Alice', resources: { lumber: 2, brick: 6 } } },
    discard1: { id: 2, move: 2, position: 1, stable: true, source: '破坏者 : Alice 丢弃 2 {lumber}', event: null },
    discard2: { id: 3, move: 3, position: 1, stable: true, source: '破坏者 : Alice 丢弃 3 {brick}', event: null },
    private: { id: 4, move: 4, position: 1, stable: true, source: '联姻: 你失去 {brick}', event: null },
  } } };
  const p = await page(saved);
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '0');
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="brick"]').textContent, '3');
  assert.equal(saved['caton:table:42:rules:3'].logs.discard1.event.type, 'loss');
  assert.equal(saved['caton:table:42:rules:3'].logs.private.event, null);
  p.dom.window.close();
  const q = await page(saved);
  assert.equal(q.panel.querySelector('[data-player="Alice"] [data-resource="brick"]').textContent, '3');
  q.dom.window.close();
});
test('replays more than 50 logs in numeric order, deduplicates DOM redraws and restores after refresh', async () => {
  const saved = {};
  const first = await page(saved, Array.from({ length: 65 }, (_, i) => gainLog(65 - i)).join(''));
  assert.equal(first.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '65');
  first.dom.window.document.querySelector('#logs').insertAdjacentHTML('beforeend', gainLog(65));
  await pause();
  assert.equal(first.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '65');
  first.dom.window.close();
  const second = await page(saved, gainLog(65).replace('id="log_65"', 'id="log_0"'));
  assert.equal(second.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '65');
  assert.match(second.panel.textContent, /65/);
  second.dom.window.close();
});
test('attaches when BGA inserts players and log container after script startup', async () => {
  const p = await page();
  const doc = p.dom.window.document;
  doc.querySelector('#logs').remove();
  const logs = doc.createElement('div'); logs.id = 'logs'; logs.innerHTML = gainLog(2, 3); doc.body.append(logs);
  await pause();
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '3');
  p.dom.window.close();
});
test('same-text events with different stable IDs both count', async () => {
  const p = await page({}, gainLog(1) + gainLog(2));
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '2');
  p.dom.window.close();
});

test('private gain reveals own hidden theft without creating a second card', async () => {
  const logs = '<div id="log_1" data-move-id="1"><div class="roundedbox">Bob Smith 获得 2 <span class="icon_ore"></span></div></div>'
    + '<div id="log_2" data-move-id="2"><div class="roundedbox">Alice 从 Bob Smith 处偷取了 1 张资源卡</div></div>'
    + '<div id="log_3" data-move-id="2"><div class="roundedbox">Alice 获得 <span class="icon_ore"></span></div></div>';
  const p = await page({}, logs);
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="ore"]').textContent, '1');
  assert.equal(p.panel.querySelector('[data-player="Bob Smith"] [data-resource="ore"]').textContent, '1');
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="unknown"]').textContent, '0');
  p.dom.window.close();
});
test('manual correction persists after refresh and precedes new events', async () => {
  const saved = {}; const p = await page(saved, gainLog(1));
  p.panel.querySelector('[data-player="Alice"] button').click();
  const form = p.panel.querySelector('form');
  form.querySelector('input').value = 8;
  form.dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await pause(); p.dom.window.close();
  const q = await page(saved, gainLog(1) + gainLog(2));
  assert.equal(q.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '9');
  q.dom.window.close();
});

test('conditional BGA timestamps do not change persisted event identity', async () => {
  const saved = {};
  const timestamped = gainLog(8).replace('</div></div>', '</div><div class="timestamp">14:35</div></div>');
  const p = await page(saved, timestamped); p.dom.window.close();
  const q = await page(saved, gainLog(8).replace('id="log_8"', 'id="log_0"'));
  assert.equal(q.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '1');
  q.dom.window.close();
});

test('BGA current-player-board hides self by default regardless of the old display preference', async () => {
  const p = await page({ 'caton:preferences': { visible: true, hideSelf: false } }, '', ['Alice', 'Bob Smith'], false);
  p.dom.window.document.querySelector('.player-board.current').className = 'player-board current-player-board';
  p.dom.window.document.querySelector('#logs').insertAdjacentHTML('beforeend', gainLog(1));
  await pause();
  assert.equal(p.panel.querySelector('[data-player="Alice"]'), null);
  assert.ok(p.panel.querySelector('[data-player="Bob Smith"]'));
  p.dom.window.close();
});

test('parser upgrade keeps the old journal intact without replaying obsolete event interpretations', async () => {
  const legacy = { logs: { old: { id: 1, move: 1, position: 1, stable: true, event: { type: 'gain', player: 'Alice', resources: { lumber: 99 } } } }, corrections: [] };
  const saved = { 'caton:table:42': legacy };
  const p = await page(saved, gainLog(2, 3));
  assert.equal(p.panel.querySelector('[data-player="Alice"] [data-resource="lumber"]').textContent, '3');
  assert.deepEqual(saved['caton:table:42'], legacy);
  assert.ok(saved['caton:table:42:rules:3']);
  p.dom.window.close();
});

test('commodity production appears in the panel and can be manually calibrated', async () => {
  const p = await page({}, '<div id="log_1" data-move-id="1"><div class="roundedbox">Alice 获得 <div class="icon_paper"></div></div></div>');
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=paper]').textContent, '1');
  p.panel.querySelector('[data-player=Alice] button').click();
  const paper = [...p.panel.querySelectorAll('form input')].find(n => n.getAttribute('aria-label').includes('纸'));
  assert.ok(paper);
  paper.value = 5;
  p.panel.querySelector('form').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=paper]').textContent, '5');
  p.dom.window.close();
});

test('the real-match hand can be confirmed after rollback and remains correct across refresh', async () => {
  const saved = {};
  const html = rows => rows.map(r => `<div id="log_${r.id}"${r.move == null ? '' : ` data-move-id="${r.move}"`}><div class="roundedbox">${r.html}</div></div>`).join('');
  const first = await page(saved, html(require('./fixtures/bga-ck-match.json')), ['Alice', 'Bob', 'Carol']);
  const hand = p => Object.fromEntries([...p.panel.querySelectorAll('[data-player=Alice] [data-resource]')].map(n => [n.dataset.resource, Number(n.textContent)]));
  const expected = { lumber: 2, brick: 3, wool: 0, grain: 0, ore: 0, paper: 2, cloth: 0, coin: 0, unknown: 0 };
  assert.doesNotMatch(first.panel.querySelector('[data-player=Alice]').textContent, /待校正/);
  assert.equal(first.panel.querySelector('[data-player=Alice] .total').textContent, '7');
  first.panel.querySelector('[data-player=Alice] button').click();
  assert.deepEqual([...first.panel.querySelectorAll('form input')].map(n => Number(n.value)), Object.values(expected));
  first.panel.querySelector('form').dispatchEvent(new first.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(hand(first), expected);
  await pause(); first.dom.window.close();
  const second = await page(saved, html(require('./fixtures/bga-ck-tail.json')), ['Alice', 'Bob', 'Carol']);
  assert.deepEqual(hand(second), expected);
  second.dom.window.close();
});
test('the actual live-game journal at move 321 matches the independently observed eight-card hand', async () => {
  const logs = Object.fromEntries(require('./fixtures/bga-ck-live-321.json').map((entry, i) => [String(i), { ...entry, stable: true }]));
  const p = await page({ 'caton:table:42:rules:3': { logs, corrections: [] } }, '', ['Alice', 'Bob', 'Carol']);
  const hand = Object.fromEntries([...p.panel.querySelectorAll('[data-player=Alice] [data-resource]')].map(n => [n.dataset.resource, Number(n.textContent)]));
  assert.deepEqual(hand, { lumber: 0, brick: 3, wool: 0, grain: 0, ore: 1, paper: 4, cloth: 0, coin: 0, unknown: 0 });
  assert.equal(p.panel.querySelector('[data-player=Alice] .total').textContent, '8');
  assert.doesNotMatch(p.panel.querySelector('[data-player=Alice]').textContent, /待校正/);
  p.dom.window.close();
});

test('unsettled players are visibly marked until their hand is calibrated', async () => {
  const p = await page({}, '<div id="log_1" data-move-id="1"><div class="roundedbox">Alice 升级为城市</div></div>');
  assert.match(p.panel.querySelector('[data-player=Alice]').textContent, /待校正/);
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '—');
  assert.equal(p.panel.querySelector('[data-player=Alice] .total').textContent, '—');
  assert.equal(p.panel.querySelector('[data-player="Bob Smith"] .total').textContent, '0');
  p.panel.querySelector('[data-player=Alice] button').click();
  p.panel.querySelector('form').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.doesNotMatch(p.panel.querySelector('[data-player=Alice]').textContent, /待校正/);
  assert.equal(p.panel.querySelector('[data-player=Alice] .total').textContent, '0');
  p.dom.window.close();
});

test('a live log receiving its move ID later becomes persistent without counting twice', async () => {
  const saved = {};
  const p = await page(saved, gainLog(1, 2).replace(' data-move-id="1"', ''));
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '2');
  p.dom.window.document.querySelector('#log_1').setAttribute('data-move-id', '1');
  await pause();
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '2');
  const stored = saved['caton:table:42:rules:3'];
  assert.equal(Object.values(stored.logs).filter(log => log.stable).length, 1);
  p.dom.window.close();
});

test('new production, building, bank trade and improvement logs update the open panel automatically', async () => {
  const p = await page();
  const doc = p.dom.window.document;
  const append = async (id, html) => {
    doc.querySelector('#logs').insertAdjacentHTML('beforeend', `<div id="log_${id}" data-move-id="${id}"><div class="roundedbox">${html}</div></div>`);
    await pause();
  };
  const icon = r => `<span class="icon_${r}"></span>`;
  const own = r => Number(p.panel.querySelector(`[data-player=Alice] [data-resource=${r}]`).textContent);
  await append(1, `Alice 获得 6${icon('lumber')}3${icon('brick')}2${icon('wool')}3${icon('grain')}3${icon('ore')}3${icon('paper')}`);
  assert.equal(own('lumber'), 6);
  await append(2, 'Alice 造了一条路');
  assert.equal(own('lumber'), 5); assert.equal(own('brick'), 2);
  await append(3, `Alice 用资源进行交易: <span style="white-space:nowrap">4${icon('lumber')}</span> → <span style="white-space:nowrap">${icon('ore')}</span>`);
  assert.equal(own('lumber'), 1); assert.equal(own('ore'), 4);
  await append(4, 'Alice 升级为城市');
  assert.equal(own('grain'), 1); assert.equal(own('ore'), 1);
  await append(5, 'Alice build a Aqueduct and improves its science level to 3');
  assert.equal(own('paper'), 0);
  assert.equal(p.panel.querySelector('[data-player=Alice] .total').textContent, '7');
  p.dom.window.close();
});

test('live private loss arriving before the public theft is reconciled without a second debit', async () => {
  const p = await page({}, gainLog(1, 2) + '<div id="log_2" data-move-id="2"><div class="roundedbox">Alice 获得 <span class="icon_ore"></span></div></div>');
  const logs = p.dom.window.document.querySelector('#logs');
  logs.insertAdjacentHTML('beforeend', '<div id="log_3"><div class="roundedbox">你失去<span class="icon_lumber"></span></div></div>');
  await pause();
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '1');
  logs.insertAdjacentHTML('beforeend', '<div id="log_4" data-move-id="3"><div class="roundedbox">Bob Smith 从 Alice 处偷取资源</div></div>');
  await pause();
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '1');
  assert.equal(p.panel.querySelector('[data-player=Alice] [data-resource=ore]').textContent, '1');
  assert.equal(p.panel.querySelector('[data-player="Bob Smith"] [data-resource=lumber]').textContent, '1');
  p.dom.window.close();
});
test('extension invalidation during pagehide is caught and requests a page refresh', async () => {
  const p = await page({}, gainLog(1));
  const errors = [];
  p.dom.window.addEventListener('error', e => { errors.push(e.message); e.preventDefault(); });
  p.dom.window.chrome.storage.local.set = () => { throw new Error('Extension context invalidated.'); };
  p.dom.window.dispatchEvent(new p.dom.window.Event('pagehide'));
  await pause();
  assert.deepEqual(errors, []);
  assert.match(p.panel.querySelector('.status').textContent, /扩展.*刷新/);
  p.dom.window.close();
});
test('an invalidated extension stops observing instead of repeatedly saving through a dead context', async () => {
  const p = await page(); let calls = 0;
  p.dom.window.chrome.storage.local.set = () => { calls++; throw new Error('Extension context invalidated.'); };
  const logs = p.dom.window.document.querySelector('#logs');
  logs.insertAdjacentHTML('beforeend', gainLog(1)); await pause();
  assert.match(p.panel.querySelector('.status').textContent, /扩展.*刷新/);
  const before = calls;
  logs.insertAdjacentHTML('beforeend', gainLog(2)); await pause();
  assert.equal(calls, before);
  p.dom.window.close();
});
test('a successful retry clears a transient storage failure', async () => {
  const p = await page();
  const original = p.dom.window.chrome.storage.local.set;
  p.dom.window.chrome.storage.local.set = async () => { throw new Error('quota'); };
  const logs = p.dom.window.document.querySelector('#logs');
  logs.insertAdjacentHTML('beforeend', gainLog(1)); await pause();
  assert.match(p.panel.querySelector('.status').textContent, /本地保存失败/);
  p.dom.window.chrome.storage.local.set = original;
  logs.insertAdjacentHTML('beforeend', gainLog(2)); await pause();
  assert.equal(p.panel.querySelector('.status'), null);
  p.dom.window.close();
});
test('a calibration made before a log receives its move ID persists once that ID arrives', async () => {
  const saved = {};
  const p = await page(saved, gainLog(1).replace(' data-move-id="1"', ''));
  p.panel.querySelector('[data-player=Alice] button').click();
  p.panel.querySelector('form input').value = 8;
  p.panel.querySelector('form').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  p.dom.window.document.querySelector('#log_1').setAttribute('data-move-id', '1');
  await pause(); p.dom.window.close();
  const q = await page(saved, gainLog(1) + gainLog(2));
  assert.equal(q.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '9');
  q.dom.window.close();
});
test('a pending calibration follows its private detail into the matched public transfer', async () => {
  const saved = {};
  const privateLog = '<div id="log_2"><div class="roundedbox">你失去 1 <span class="icon_lumber"></span></div></div>';
  const publicLog = '<div id="log_3" data-move-id="2"><div class="roundedbox">Bob Smith 从 Alice 处偷取资源</div></div>';
  const p = await page(saved, gainLog(1, 2) + privateLog);
  p.panel.querySelector('[data-player=Alice] button').click();
  p.panel.querySelector('form input').value = 8;
  p.panel.querySelector('form').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  p.dom.window.document.querySelector('#logs').insertAdjacentHTML('beforeend', publicLog);
  await pause(); p.dom.window.close();
  const q = await page(saved, gainLog(1, 2) + publicLog + gainLog(4));
  assert.equal(q.panel.querySelector('[data-player=Alice] [data-resource=lumber]').textContent, '9');
  q.dom.window.close();
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const scripts = ['engine', 'parser', 'journal', 'panel', 'content'];
const pause = () => new Promise(r => setTimeout(r, 350));
async function page(saved = {}, logs = '') {
  const dom = new JSDOM(`<div id="player_boards"><div class="player-board current"><div class="player-name"><a>Alice</a></div></div><div class="player-board"><div class="player-name"><a>Bob Smith</a></div></div></div><div id="logs">${logs}</div>`, { url: 'https://boardgamearena.com/1/catan?table=42', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.structuredClone = structuredClone;
  dom.window.chrome = {
    storage: { local: { async get(key) { return structuredClone({ [key]: saved[key] }); }, async set(value) { Object.assign(saved, structuredClone(value)); } } },
    runtime: { onMessage: { addListener() {} } },
  };
  for (const script of scripts) dom.window.eval(readFileSync(`src/${script}.js`, 'utf8'));
  await pause();
  return { dom, saved, panel: dom.window.document.querySelector('#oh-my-caton').shadowRoot };
}
const gainLog = (id, n = 1) => `<div class="log" id="log_${id}" data-move-id="${id}"><div class="roundedbox">Alice 获得 <span style="white-space: nowrap">${n} <span class="cat_log_token icon_lumber"></span></span></div></div>`;
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

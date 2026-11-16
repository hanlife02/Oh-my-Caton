(() => {
  'use strict';
  const labels = { lumber: '🌲 木材', brick: '🧱 砖块', wool: '🐑 羊毛', grain: '🌾 麦子', ore: '⛰️ 矿石', paper: '📄 纸', cloth: '🧵 布', coin: '🪙 金币', unknown: '❓ 未知' };
  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  class Panel {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.host = el('aside', undefined, { id: 'oh-my-caton', 'aria-label': '卡坦岛资源追踪器' });
      this.host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:calc(100vw - 16px)';
      const shadow = this.host.attachShadow({ mode: 'open' });
      const style = el('style', `
        :host{all:initial;color-scheme:dark;font:13px/1.5 system-ui,sans-serif;color:#e7ede9}
        :host([hidden]){display:none} *{box-sizing:border-box} .panel{width:470px;max-width:calc(100vw - 16px);background:#17251f;border:1px solid #455d4e;border-radius:16px;box-shadow:0 12px 50px #0006;overflow:hidden}
        header{display:flex;align-items:center;gap:9px;padding:14px 16px;background:#21382b;cursor:move;touch-action:none}
        header strong{flex:1;font-size:16px;letter-spacing:.3px}button{font:inherit;border:1px solid #52695b;border-radius:7px;background:#2a4133;color:#eef5ed;padding:4px 9px;cursor:pointer}button:hover{background:#3c5945}button:focus-visible,input:focus-visible{outline:2px solid #eac975;outline-offset:2px}
        .body{padding:12px 14px;max-height:65vh;overflow:auto}.meta{display:flex;justify-content:space-between;color:#c4d5c6;font-size:11px;margin-bottom:10px}
        table{border-collapse:collapse;width:100%;text-align:center;table-layout:fixed}th,td{padding:8px 2px;border-bottom:1px solid #354b3d}th{font-size:12px;font-weight:500;color:#c4d5c6}th:first-child,td:first-child{width:105px;text-align:left;overflow-wrap:anywhere}td{font-variant-numeric:tabular-nums;font-size:15px}td:first-child{font-size:12px}td button{font-size:11px;padding:1px 5px;margin-left:4px} .total{color:#eac975}
        .help{color:#c4d5c6;font-size:11px;margin:10px 0}.status{font-size:12px;color:#eac975;margin:8px 0;overflow-wrap:anywhere}.tools{display:flex;gap:10px;align-items:center;margin-top:12px}.tools label{flex:1;font-size:12px}input[type=checkbox]{accent-color:#eac975}details{margin-top:10px;color:#c4d5c6;font-size:11px}li{margin-bottom:5px;overflow-wrap:anywhere}ul{padding-left:18px}form{padding:10px;background:#21382b;border-radius:8px;margin-top:10px}form label{display:inline-flex;flex-direction:column;margin:3px;width:58px;font-size:11px}input[type=number]{width:58px;background:#17251f;border:1px solid #52695b;color:#fff;border-radius:4px;padding:5px}form p{margin:0 0 6px}form button{margin:8px 6px 0 0}
      `);
      this.root = el('section', undefined, { class: 'panel' });
      const header = el('header');
      header.append(el('span', '⬡'), el('strong', 'Oh my Caton'));
      const minimize = el('button', '−', { 'aria-label': '折叠面板', 'aria-expanded': 'true' });
      minimize.addEventListener('click', () => {
        this.body.hidden = !this.body.hidden;
        minimize.textContent = this.body.hidden ? '+' : '−';
        minimize.setAttribute('aria-expanded', String(!this.body.hidden));
      });
      const close = el('button', '×', { 'aria-label': '隐藏面板' });
      close.addEventListener('click', () => callbacks.visibility(false));
      header.append(minimize, close);
      this.body = el('div', undefined, { class: 'body' });
      this.root.append(header, this.body);
      shadow.append(style, this.root);
      document.body.append(this.host);
      let drag;
      header.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        const rect = this.host.getBoundingClientRect();
        drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        header.setPointerCapture(event.pointerId);
      });
      header.addEventListener('pointermove', event => {
        if (!drag) return;
        this.host.style.right = 'auto'; this.host.style.bottom = 'auto';
        this.host.style.left = `${Math.max(0, Math.min(innerWidth - this.host.offsetWidth, event.clientX - drag.x))}px`;
        this.host.style.top = `${Math.max(0, Math.min(innerHeight - this.host.offsetHeight, event.clientY - drag.y))}px`;
      });
      header.addEventListener('pointerup', () => { drag = null; });
      header.addEventListener('pointercancel', () => { drag = null; });
    }
    visible(value) { this.host.hidden = !value; }
    render({ tracker, names, current, journal, hideSelf, table, error }) {
      this.body.replaceChildren();
      const meta = el('div', undefined, { class: 'meta' });
      meta.append(el('span', `BGA · 桌号 ${table}`), el('span', `${Object.keys(journal.logs).length} 条日志 · 本地保存`));
      this.body.append(meta);
      const grid = el('table', undefined, { 'aria-label': '各玩家资源数量' });
      const head = el('tr'); head.append(el('th', '玩家'));
      for (const r of Caton.resources) head.append(el('th', labels[r].split(' ')[0], { title: labels[r], scope: 'col' }));
      head.append(el('th', '合计')); const thead = el('thead'); thead.append(head); grid.append(thead);
      const tbody = el('tbody');
      for (const name of names) {
        if (hideSelf && name === current) continue;
        const row = el('tr', undefined, { 'data-player': name });
        const nameCell = el('td', name);
        if (tracker.warnings.some(w => w.unresolved.includes(name))) nameCell.append(el('small', ' ⚠ 待校正'));
        const edit = el('button', '✎', { 'aria-label': `校正 ${name} 的手牌` });
        edit.addEventListener('click', () => this.edit(name, tracker.players[name]));
        nameCell.append(edit); row.append(nameCell);
        for (const r of Caton.resources) row.append(el('td', String(tracker.players[name][r]), { 'data-resource': r, title: labels[r] }));
        row.append(el('td', String(tracker.total(name)), { class: 'total' })); tbody.append(row);
      }
      grid.append(tbody); this.body.append(grid);
      const warnings = tracker.warnings;
      this.body.append(el('p', error || (warnings.length ? `⚠ ${warnings.length} 条日志无法结算，请校正相关手牌。` : names.length ? '● 正在监听页面可见日志' : '等待游戏玩家与日志加载…'), { class: 'status', role: 'status' }));
      this.body.append(el('p', '无待校正提示时，数字为确定持有的最低数量；❓ 为牌型不确定的剩余手牌。标为待校正的玩家数字暂不可信。中途加入时请先校正，插件无法恢复未见过的历史日志。', { class: 'help' }));
      const tools = el('div', undefined, { class: 'tools' });
      const label = el('label'); const check = el('input', undefined, { type: 'checkbox' }); check.checked = hideSelf;
      check.addEventListener('change', () => this.callbacks.hideSelf(check.checked));
      label.append(check, document.createTextNode(' 隐藏自己')); tools.append(label);
      const scan = el('button', '重新扫描'); scan.addEventListener('click', () => this.callbacks.scan()); tools.append(scan);
      const reset = el('button', '重算'); reset.addEventListener('click', () => {
        if (confirm('清除本桌手动校正，并根据已保存的日志重新计算？')) this.callbacks.reset();
      }); tools.append(reset); this.body.append(tools);
      const review = el('details'); review.append(el('summary', '最近日志与提示'));
      const list = el('ul');
      for (const warning of warnings.slice(-5)) list.append(el('li', `${warning.unresolved.join("、")}：${warning.message}`));
      for (const entry of Object.values(journal.logs).sort((a, b) => Caton.compareLogs(b, a)).slice(0, 8)) list.append(el('li', `${entry.event ? '✓' : '·'} ${entry.text}`));
      review.append(list); this.body.append(review);
      this.editor = el('div'); this.body.append(this.editor);
    }
    edit(name, hand) {
      this.editor.replaceChildren();
      const form = el('form'); form.append(el('p', `校正 ${name} 的当前手牌`));
      const inputs = {};
      for (const r of Caton.resources) {
        const label = el('label', labels[r]);
        const input = el('input', undefined, { type: 'number', min: '0', max: '999', step: '1', required: '', 'aria-label': labels[r] });
        input.value = hand[r]; inputs[r] = input; label.append(input); form.append(label);
      }
      form.append(el('br'));
      const submit = el('button', '保存校正', { type: 'submit' });
      const cancel = el('button', '取消', { type: 'button' }); cancel.addEventListener('click', () => this.editor.replaceChildren());
      form.append(submit, cancel);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const resources = Object.fromEntries(Caton.resources.map(r => [r, Number(inputs[r].value)]));
        this.callbacks.correct(name, resources);
      });
      this.editor.append(form); inputs.lumber.focus();
    }
  }
  Object.assign(globalThis.Caton, { Panel });
})();

(async () => {
  'use strict';
  if (!/\/catan\/?$/.test(location.pathname) || document.getElementById('oh-my-caton')) return;
  const table = new URL(location.href).searchParams.get('table');
  if (!table || !/^\d+$/.test(table)) return;
  // Keep pre-upgrade journals intact: their parsed events use obsolete rules.
  const legacyKey = `caton:table:${table}`;
  const key = `${legacyKey}:rules:3`;
  const prefsKey = 'caton:preferences';
  const page = crypto.randomUUID();
  let historyWarning = '';
  let journal = { logs: {}, corrections: [] };
  let prefs = { visible: true, hideSelf: false };
  let names = [], current = null, error = '', timer, saveTimer;
  let tracker = new Caton.Tracker([]);
  const storage = chrome.storage.local;
  try {
    const stored = await storage.get(key);
    const legacy = await storage.get(legacyKey);
    const prior = await storage.get(`${legacyKey}:rules:2`);
    const preferences = await storage.get(prefsKey);
    if (stored[key]?.logs && Array.isArray(stored[key]?.corrections)) journal = stored[key];
    else if (legacy[legacyKey] || prior[`${legacyKey}:rules:2`]) error = '解析规则已更新，旧存档已保留；当前重算可见日志，请校正手牌。';
    if (preferences[prefsKey]) prefs = { ...prefs, ...preferences[prefsKey] };
  } catch { error = '无法读取本地存档，当前仅在页面内追踪。'; }
  function draw() { panel.render({ tracker, names, current, journal, hideSelf: prefs.hideSelf, table, error: [error, historyWarning].filter(Boolean).join(' ') }); }
  function savedJournal() { return { ...journal, corrections: journal.corrections.filter(c => c.after.move != null), logs: Object.fromEntries(Object.entries(journal.logs).filter(([, log]) => log.stable)) }; }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await storage.set({ [key]: savedJournal(), [prefsKey]: prefs }); }
      catch { error = '本地保存失败，请勿刷新；可检查扩展存储空间。'; draw(); }
    }, 100);
  }
  function replay() {
    tracker = new Caton.Tracker(names);
    const entries = Object.values(journal.logs).map(log => ({ ...log, rank: 0 }));
    journal.corrections.forEach((correction, i) => entries.push({ ...correction.after, rank: i + 1, event: correction.event }));
    entries.sort(Caton.compareLogs);
    Caton.replayLogs(tracker, entries, current);
    draw();
  }
  function scan() {
    const players = Array.from(document.querySelectorAll('#player_boards .player-board'));
    const roster = [...new Set(players.map(board => board.querySelector('.player-name a')?.textContent.trim()).filter(Boolean))];
    let changed = JSON.stringify(roster) !== JSON.stringify(names);
    names = roster;
    current = players.find(board => board.matches('.current-player-board, .current'))?.querySelector('.player-name a')?.textContent.trim() || null;
    if (!names.length) { draw(); return; }
    const incoming = [];
    for (const node of document.querySelectorAll('#logs [id^="log_"]')) {
      const match = node.id.match(/^log_(\d+)$/);
      if (!match || !node.querySelector('.roundedbox')) continue;
      const id = Number(match[1]);
      const event = Caton.parseLog(node, names, current);
      const source = Caton.logText(node.querySelector('.roundedbox')).replace(/\s+/g, ' ').trim();
      const text = node.querySelector('.roundedbox').textContent.replace(/\s+/g, ' ').trim();
      const rawMove = node.getAttribute('data-move-id');
      const move = rawMove !== null && /^\d+$/.test(rawMove) ? Number(rawMove) : null;
      incoming.push({ id, move, event, text, source });
    }
    incoming.sort((a, b) => a.id - b.id);
    const result = Caton.mergeLogs(journal.logs, Caton.prepareLogs(incoming), page);
    const nextWarning = result.unverified ? '⚠ 历史标识缺失或同回合日志不完整，无法可靠匹配，请校正手牌。' : '';
    changed = changed || result.changed || historyWarning !== nextWarning;
    historyWarning = nextWarning;
    if (changed) { replay(); persist(); }
  }
  const panel = new Caton.Panel({
    visibility(value) { prefs.visible = value; panel.visible(value); persist(); },
    hideSelf(value) { prefs.hideSelf = value; draw(); persist(); },
    scan,
    reset() { journal.corrections = []; replay(); persist(); },
    correct(player, resources) {
      const last = Object.values(journal.logs).sort(Caton.compareLogs).at(-1);
      journal.corrections.push({ after: last ? { move: last.move, position: last.position } : { move: 0, position: 0 }, event: { type: 'set', player, resources } });
      replay(); persist();
    },
  });
  panel.visible(prefs.visible);
  draw(); scan();
  const observer = new MutationObserver(mutations => {
    if (!mutations.some(mutation => mutation.target !== panel.host && !panel.host.contains(mutation.target))) return;
    clearTimeout(timer); timer = setTimeout(scan, 60);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-move-id'] });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.action === 'caton:toggle') {
      prefs.visible = !prefs.visible; panel.visible(prefs.visible); persist(); respond({ visible: prefs.visible });
    } else if (message.action === 'caton:scan') { scan(); respond({ ok: true }); }
  });
  addEventListener('pagehide', () => { clearTimeout(saveTimer); storage.set({ [key]: savedJournal(), [prefsKey]: prefs }).catch(() => {}); });
})();

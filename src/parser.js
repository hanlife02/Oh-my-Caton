(() => {
  'use strict';
  const { resources } = globalThis.Caton;
  function logText(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    const resource = resources.find(r => node.classList.contains(`icon_${r}`));
    if (resource) return ` {${resource}} `;
    return Array.from(node.childNodes, logText).join('');
  }
  function bundle(text) {
    const result = {};
    const regex = /(\d+)?\s*\{(lumber|brick|wool|grain|ore|unknown)\}/g;
    for (const match of text.matchAll(regex)) result[match[2]] = (result[match[2]] || 0) + Number(match[1] || 1);
    return result;
  }
  function parseLog(node, names) {
    const text = logText(node.querySelector('.roundedbox') || node).replace(/\s+/g, ' ').trim();
    const ordered = [...names].sort((a, b) => b.length - a.length);
    const player = ordered.find(name => text.startsWith(name));
    if (!player) return null;
    const action = text.slice(player.length).trim();
    if (/没有.*偷|未能.*偷|偷.*(?:失败|不到)|stole nothing|could not steal|did not steal/i.test(action)) return null;
    const groups = Array.from(node.querySelectorAll('span[style*="nowrap"]'))
      .filter(el => !el.parentElement.closest('span[style*="nowrap"]'))
      .map(el => bundle(logText(el))).filter(g => Object.keys(g).length);
    const found = bundle(action);
    const other = ordered.find(name => name !== player && action.includes(name));
    // Specific compound actions must precede generic gain/loss words.
    if (/和银行交易|与银行交易|traded? with (?:the )?bank/i.test(action)) {
      if (groups.length !== 2) return null;
      return { type: 'bank', player, give: groups[0], receive: groups[1] };
    }
    if (/交给|traded? with/i.test(action) && other) {
      if (groups.length !== 2) return null;
      return { type: 'trade', player, other, give: groups[0], receive: groups[1] };
    }
    if (/偷取|偷走|stole|steals/i.test(action)) {
      if (!other) return null;
      const count = Number(action.match(/(?:偷取了?|stole|steals)\s*(\d+)/i)?.[1] || 1);
      return { type: 'steal', player, victim: other, resources: Object.keys(found).length ? found : { unknown: count } };
    }
    const building = /买.*发展卡|购买.*发展卡|bought.*development card/i.test(action) ? 'development'
      : /升级.*城市|upgraded.*city|built.*city/i.test(action) ? 'city'
      : /造.*(?:道路|条路)|建造.*道路|built.*road|placed.*road/i.test(action) ? 'road'
      : /造.*(?:村庄|定居点)|built.*settlement|placed.*settlement/i.test(action) ? 'settlement' : null;
    if (building) return { type: 'build', player, building, free: /免费|初始|放置|free|placed|road building/i.test(action) };
    const type = /弃置|失去|丢弃|discarded|loses|lost/i.test(action) ? 'loss'
      : /获得|得到了|received|receives|gained|gets/i.test(action) ? 'gain' : null;
    if (!type) return null;
    if (!Object.keys(found).length) {
      const count = action.match(/(\d+)\s*(?:张|resource cards?|cards?)/i);
      if (!count) return null;
      found.unknown = Number(count[1]);
    }
    return { type, player, resources: found };
  }
  Object.assign(globalThis.Caton, { parseLog });
})();

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
    const regex = /(\d+)?\s*\{(lumber|brick|wool|grain|ore|paper|cloth|coin|unknown)\}/g;
    for (const match of text.matchAll(regex)) result[match[2]] = (result[match[2]] || 0) + Number(match[1] || 1);
    return result;
  }
  function parseLog(node, names, current = null) {
    const raw = logText(node.querySelector('.roundedbox') || node).replace(/\s+/g, ' ').trim();
    const variableTheft = /^(?:资源垄断|商品垄断|联姻|大商家|Resource Monopoly|Trade Monopoly|Wedding|Master Merchant)\s*[:：]/i.test(raw);
    const ordered = [...names].sort((a, b) => b.length - a.length);
    let text = raw.replace(/^⇌\s*(?:强制交易[！!]\s*)?/, '');
    const startsWithActor = value => ordered.some(name => value.startsWith(name)) || /^(?:你|You\b)/i.test(value);
    const prefixed = text.match(/^[^:：]+[:：]\s*(.*)$/);
    if (!startsWithActor(text) && prefixed && startsWithActor(prefixed[1])) text = prefixed[1];
    const privateLog = /^(?:你|You\b)/i.test(text) && current && names.includes(current);
    const player = privateLog ? current : ordered.find(name => text.startsWith(name));
    if (!player) return null;
    const action = (privateLog ? text.replace(/^(?:你|You\b)/i, '') : text.slice(player.length)).trim();
    const progressCard = /发展卡|进步卡|(?:progress|development) cards?/i.test(action);
    if (/提出.*交易请求|proposes?.*trade/i.test(action)) return null;
    if (/没有.*偷|未能.*偷|偷.*(?:失败|不到)|stole nothing|could not steal|did not steal/i.test(action)) return null;
    const groups = Array.from(node.querySelectorAll('span[style*="nowrap"]'))
      .filter(el => !el.parentElement.closest('span[style*="nowrap"]'))
      .map(el => bundle(logText(el))).filter(g => Object.keys(g).length);
    const found = bundle(action);
    const other = ordered.find(name => name !== player && action.includes(name));
    const monopoly = raw.match(/^(资源垄断|商品垄断|Resource Monopoly|Trade Monopoly)\s*[:：]/i);
    const requested = action.match(/^索要\s*(lumber|brick|wool|grain|ore|paper|cloth|coin)\b/i);
    if (monopoly && requested) {
      const resource = requested[1].toLowerCase();
      const commodity = /商品|Trade/i.test(monopoly[1]);
      if ((commodity ? ['paper', 'cloth', 'coin'] : ['lumber', 'brick', 'wool', 'grain', 'ore']).includes(resource)) return { type: 'monopolyChoice', player, resource, max: commodity ? 1 : 2 };
    }
    const forced = action.match(/^将\s*(.*?)\s*给\s*.*?[，,]后者提供\s*(.*?)\s*作为交换/);
    if (forced && other) return { type: 'trade', player, other, give: bundle(forced[1]), receive: bundle(forced[2]) };
    if (/回滚操作|取消了他的行动|undo|roll.?back/i.test(action)) return { type: 'unresolved', player, affected: names, message: '发生回滚，请校正受影响玩家的手牌。' };
    if (/打出了\s*起重机|played.*crane/i.test(action)) return { type: 'crane', player };
    if (/跳过|ends? (?:their |the )?turn/i.test(action)) return { type: 'turnEnd', player };
    const improvement = action.match(/improves?\s+(?:its|their)\s+(science|trade|politics)\s+level\s+to\s+([1-5])/i);
    if (improvement) return { type: 'improvement', player, resource: { science: 'paper', trade: 'cloth', politics: 'coin' }[improvement[1].toLowerCase()], level: Number(improvement[2]) };
    // Specific compound actions must precede generic gain/loss words.
    if (/用资源进行交易|和银行交易|与银行交易|traded? with (?:the )?bank/i.test(action)) {
      const arrow = action.match(/[:：]\s*(.*?)\s*→\s*(.*)$/);
      if (arrow && Object.keys(bundle(arrow[1])).length && Object.keys(bundle(arrow[2])).length) return { type: 'bank', player, give: bundle(arrow[1]), receive: bundle(arrow[2]) };
      if (groups.length !== 2) return null;
      return { type: 'bank', player, give: groups[0], receive: groups[1] };
    }
    if (/交给|traded? with/i.test(action) && other) {
      const exchanged = action.slice(action.indexOf(other) + other.length).match(/^(.*?)\s*并收到\s*(.*?)\s*作为交换/);
      if (exchanged && Object.keys(bundle(exchanged[1])).length && Object.keys(bundle(exchanged[2])).length) return { type: 'trade', player, other, give: bundle(exchanged[1]), receive: bundle(exchanged[2]) };
      if (groups.length !== 2) return null;
      return { type: 'trade', player, other, give: groups[0], receive: groups[1] };
    }
    if (/偷取|偷走|stole|steals/i.test(action)) {
      if (progressCard) return null;
      if (!other) return null;
      const count = Number(action.match(/(?:偷取了?|stole|steals)\s*(\d+)/i)?.[1] || 1);
      return { type: 'steal', player, victim: other, resources: Object.keys(found).length ? found : variableTheft ? null : { unknown: count } };
    }
    if (/花费.*(?:骑士|城墙)|为.*激活骑士/i.test(action)) return { type: 'loss', player, resources: found };
    const building = /买.*发展卡|购买.*发展卡|bought.*development card/i.test(action) ? 'development'
      : /升级.*城市|upgraded.*city|built.*city/i.test(action) ? 'city'
      : /造.*(?:道路|条路)|放置.*(?:道路|条路)|built.*road|placed.*road/i.test(action) ? 'road'
      : /造.*(?:村庄|定居点)|放置.*(?:村庄|定居点)|built.*settlement|placed.*settlement/i.test(action) ? 'settlement' : null;
    if (building) return { type: 'build', player, building, free: /免费|初始|放置|free|placed|road building/i.test(action),
      ...(Object.keys(found).length ? { resources: found } : {}) };
    const type = /弃置|失去|丢弃|discarded|loses|lost/i.test(action) ? 'loss'
      : /获得|得到了|received|receives|gained|gets/i.test(action) ? 'gain' : null;
    if (!type) return null;
    if (!Object.keys(found).length) {
      if (progressCard) return null;
      const count = action.match(/(\d+)\s*(?:张|resource cards?|cards?)/i);
      if (!count) return null;
      found.unknown = Number(count[1]);
    }
    return { type, player, resources: found, ...(privateLog ? { private: true } : {}) };
  }
  Object.assign(globalThis.Caton, { parseLog, logText });
})();

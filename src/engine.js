/* Counts are guaranteed minima; unknown holds the rest of a player's hand. */
(() => {
  'use strict';
  const resources = ['lumber', 'brick', 'wool', 'grain', 'ore', 'paper', 'cloth', 'coin', 'unknown'];
  const costs = {
    road: { lumber: 1, brick: 1 },
    settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
    development: { wool: 1, grain: 1, ore: 1 },
  };
  const empty = () => Object.fromEntries(resources.map(r => [r, 0]));
  const sum = hand => Object.values(hand).reduce((a, b) => a + b, 0);
  class Tracker {
    constructor(names) {
      this.players = Object.fromEntries(names.map(name => [name, empty()]));
      this.warnings = [];
    }
    total(name) { return sum(this.players[name]); }
    unresolved(name) { return this.warnings.some(w => w.unresolved.includes(name)); }
    apply(event) {
      const next = structuredClone(this.players);
      const validate = bundle => {
        if (!bundle || Object.entries(bundle).some(([r, n]) => !resources.includes(r) || !Number.isSafeInteger(n) || n < 0)) throw new Error('资源数量无效');
      };
      const hand = name => {
        if (!Object.hasOwn(next, name)) throw new Error('未知玩家');
        return next[name];
      };
      const add = (name, bundle) => {
        validate(bundle);
        for (const [r, n] of Object.entries(bundle)) hand(name)[r] += n;
      };
      const remove = (name, bundle) => {
        validate(bundle);
        const h = hand(name);
        // Invalid hands are hidden until calibrated. Their stale balance must
        // not prevent a publicly known transfer from updating the other party.
        if (this.unresolved(name)) return;
        // Spend known resources first, filling deficits from uncertain cards.
        for (const [r, n] of Object.entries(bundle)) {
          if (r === 'unknown') continue;
          const known = Math.min(h[r], n);
          h[r] -= known;
          h.unknown -= n - known;
          if (h.unknown < 0) throw new Error('日志不完整或资源不足，请校正手牌');
        }
        const count = bundle.unknown || 0;
        if (sum(h) < count) throw new Error('日志不完整或资源不足，请校正手牌');
        if (count) {
          const remaining = sum(h) - count;
          for (const r of resources.slice(0, -1)) h[r] = Math.max(0, h[r] - count);
          h.unknown = remaining - resources.slice(0, -1).reduce((n, r) => n + h[r], 0);
        }
      };
      try {
        hand(event.player);
        switch (event.type) {
          case 'gain': add(event.player, event.resources); break;
          case 'loss': remove(event.player, event.resources); break;
          case 'build':
            if (!costs[event.building]) throw new Error('未知建造类型');
            if (!event.free) remove(event.player, event.resources || costs[event.building]);
            break;
          case 'bank':
          case 'trade':
            remove(event.player, event.give);
            if (event.type === 'trade') remove(event.other, event.receive);
            add(event.player, event.receive);
            if (event.type === 'trade') add(event.other, event.give);
            break;
          case 'steal': {
            let bundle = event.resources;
            if (!bundle) throw new Error('垄断转移数量不可见，请校正相关手牌');
            validate(bundle);
            const victim = hand(event.victim);
            const known = resources.slice(0, -1).filter(r => victim[r] > 0);
            if (bundle.unknown && !this.unresolved(event.victim) && !victim.unknown && known.length === 1) bundle = { [known[0]]: bundle.unknown };
            remove(event.victim, bundle);
            add(event.player, bundle);
            break;
          }
          case 'set':
            validate(event.resources);
            next[event.player] = { ...empty(), ...event.resources };
            break;
          case 'unresolved': throw new Error(event.message);
          default: throw new Error('未知事件');
        }
        this.players = next;
        if (event.type === 'set') this.warnings = this.warnings.map(w => ({
          ...w, unresolved: w.unresolved.filter(name => name !== event.player),
        })).filter(w => w.unresolved.length);
        return true;
      } catch (error) {
        this.warnings.push({ player: event.player, other: event.other || event.victim, unresolved: [...new Set(event.affected || [event.player, event.other || event.victim].filter(Boolean))], message: error.message });
        return false;
      }
    }
  }
  globalThis.Caton = { Tracker, resources };
})();

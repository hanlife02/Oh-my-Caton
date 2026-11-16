(() => {
  'use strict';
  function prepareLogs(incoming) {
    const entries = incoming.map(entry => ({ ...entry, event: entry.event && { ...entry.event } }));
    // A rollback notification carries the restored move number. Notifications
    // before it can belong to later moves that have now been undone. Resolve
    // this in DOM notification order, before sorting by move for replay.
    for (let i = 0; i < entries.length; i++) {
      const undo = entries[i];
      if (undo.move == null || undo.event?.type !== 'unresolved' || !/回滚操作|roll.?back/i.test(undo.source || undo.text || '')) continue;
      const start = entries.findIndex((log, j) => j < i && !log.cancelled && log.move === undo.move
        && log.event && !['unresolved', 'turnEnd'].includes(log.event.type));
      if (start < 0 || entries.slice(start, i).some(log => !log.cancelled && (log.move == null || log.move < undo.move || log.event?.type === 'turnEnd'))) continue;
      for (const log of entries.slice(start, i)) { log.cancelled = true; log.cancelledById = undo.id; }
      undo.rollbackResolved = true;
      const confirmation = entries[i + 1];
      if (confirmation?.move === undo.move && confirmation.event?.type === 'unresolved'
          && confirmation.event.player === undo.event.player && /取消了他的行动/i.test(confirmation.source || confirmation.text || '')) confirmation.rollbackResolved = true;
    }
    const matched = new Map();
    for (let i = 0; i < entries.length; i++) {
      const detail = entries[i].event;
      if (!detail?.private || entries[i].cancelled) continue;
      // A notification may emit several private details before its public transfers.
      const candidates = [];
      let move = entries[i].move;
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].move != null) {
          if (move != null && entries[j].move !== move) break;
          move = entries[j].move;
        }
        candidates.push(j);
      }
      if (entries[i].move != null && entries[i - 1]?.move === entries[i].move) candidates.push(i - 1);
      for (const j of candidates) {
        const publicEvent = entries[j]?.event;
        if (!publicEvent || publicEvent.private || entries[j].cancelled) continue;
        if (matched.get(j)?.has(detail.type)) continue;
        const theft = publicEvent.type === 'steal' && (detail.type === 'gain' ? publicEvent.player === detail.player : publicEvent.victim === detail.player);
        const gain = detail.type === 'gain' && publicEvent.type === 'gain' && publicEvent.player === detail.player;
        if (!theft && !gain) continue;
        if (publicEvent.resources && !publicEvent.resources.unknown && !Caton.resources.every(r => (publicEvent.resources[r] || 0) === (detail.resources[r] || 0))) continue;
        const count = Object.values(detail.resources).reduce((a, b) => a + b, 0);
        if (publicEvent.resources?.unknown && publicEvent.resources.unknown !== count) continue;
        publicEvent.resources = detail.resources;
        publicEvent.revealed = true;
        if (!matched.has(j)) matched.set(j, new Set());
        matched.get(j).add(detail.type);
        entries[i].event = null;
        entries[i].resolvedBy = entries[j].id;
        break;
      }
    }
    return entries;
  }
  // BGA log_N is page-local. Only data-move-id survives a page reload.
  function mergeLogs(logs, incoming, page) {
    let changed = false, unverified = false;
    incoming = [...new Map(incoming.map(entry => [entry.id, entry])).values()];
    const signatureOf = entry => JSON.stringify([entry.move, entry.source || entry.event || entry.text]);
    const reserved = new Set(Object.keys(logs)), claimed = new Set();
    function keyFor(entry) {
      if (!Number.isSafeInteger(entry.move) || entry.move < 0) return `page:${page}:${entry.id}`;
      const signature = signatureOf(entry);
      const variants = Object.values(logs).filter(log => log.signature === signature && !claimed.has(log.key)
        && !!log.cancelled === !!entry.cancelled && (!entry.cancelledBy || log.cancelledBy === entry.cancelledBy)).sort(compareLogs);
      const previous = variants.find(log => log.observedPage === page && log.observedId === entry.id)
        || variants.find(log => log.observedPage !== page);
      let key = previous?.key;
      if (!key) {
        let n = 1;
        while (reserved.has(`${signature}:${n}`)) n++;
        key = `${signature}:${n}`;
      }
      reserved.add(key); claimed.add(key);
      return key;
    }
    // Give each rollback its own persistent identity before assigning the
    // cancelled actions. The same road text can occur in several branches.
    const undoKeys = new Map(incoming.filter(entry => entry.rollbackResolved && !entry.cancelled).map(entry => [entry.id, keyFor(entry)]));
    const cancelledKeys = new Map(), cancelledMatches = new Set();
    for (const entry of incoming) {
      if (!entry.cancelled) continue;
      entry.cancelledBy = undoKeys.get(entry.cancelledById);
      const variants = Object.values(logs).filter(log => log.signature === signatureOf(entry) && !cancelledMatches.has(log.key)).sort(compareLogs);
      const previous = variants.find(log => log.observedPage === page && log.observedId === entry.id)
        || variants.find(log => log.cancelled && log.cancelledBy === entry.cancelledBy)
        || variants.find(log => !log.cancelled && log.observedPage !== page);
      if (previous) {
        cancelledMatches.add(previous.key); cancelledKeys.set(entry.id, previous.key);
        if (!previous.cancelled || previous.cancelledBy !== entry.cancelledBy) {
          previous.cancelled = true; previous.cancelledBy = entry.cancelledBy; changed = true;
        }
      }
    }
    const occurrences = new Map();
    const incomingKeys = incoming.map(entry => {
      const stable = Number.isSafeInteger(entry.move) && entry.move >= 0;
      if (!stable && entry.event) unverified = true;
      const signature = signatureOf(entry);
      const group = JSON.stringify([signature, !!entry.cancelled]);
      const occurrence = (occurrences.get(group) || 0) + 1;
      occurrences.set(group, occurrence);
      const key = undoKeys.get(entry.id) || cancelledKeys.get(entry.id) || keyFor(entry);
      claimed.add(key);
      return { ...entry, stable, key, signature };
    });
    for (const entry of incomingKeys) {
      const group = JSON.stringify([entry.signature, false]);
      if (entry.stable && !entry.cancelled && Object.values(logs).filter(log => log.signature === entry.signature && !log.cancelled).length > occurrences.get(group)) unverified = true;
    }
    for (let i = 0; i < incomingKeys.length; i++) {
      const entry = incomingKeys[i];
      const ephemeralKey = `page:${page}:${entry.id}`;
      if (entry.stable && logs[ephemeralKey]) {
        delete logs[ephemeralKey];
        changed = true;
      }
      if (logs[entry.key]) {
        const existing = logs[entry.key];
        for (const flag of ['cancelled', 'rollbackResolved']) {
          if (entry[flag] && !existing[flag]) { existing[flag] = true; changed = true; }
        }
        if (entry.cancelledBy && existing.cancelledBy !== entry.cancelledBy) { existing.cancelledBy = entry.cancelledBy; changed = true; }
        if (existing.observedPage !== page || existing.observedId !== entry.id) {
          existing.observedPage = page; existing.observedId = entry.id; changed = true;
        }
        if (logs[entry.key].event?.revealed && !entry.event?.revealed) continue;
        if (JSON.stringify(logs[entry.key].event) !== JSON.stringify(entry.event)) {
          logs[entry.key].event = entry.event;
          changed = true;
        }
        continue;
      }
      const prior = incomingKeys.slice(0, i).reverse().find(log => log.move === entry.move && logs[log.key]);
      const next = incomingKeys.slice(i + 1).find(log => log.move === entry.move && logs[log.key]);
      const previousPosition = prior ? logs[prior.key].position : undefined;
      const nextPosition = next ? logs[next.key].position : undefined;
      const position = previousPosition !== undefined && nextPosition !== undefined ? (previousPosition + nextPosition) / 2
        : nextPosition !== undefined ? nextPosition - 1
        : previousPosition !== undefined ? previousPosition + 1
        : Math.max(0, ...Object.values(logs).filter(log => log.move === entry.move).map(log => log.position)) + 1;
      logs[entry.key] = { ...entry, position, observedPage: page, observedId: entry.id };
      changed = true;
    }
    const anchors = Object.fromEntries(incomingKeys.map(entry => [entry.id, { move: entry.move, position: logs[entry.key].position }]));
    for (const entry of incomingKeys) {
      if (entry.resolvedBy != null && anchors[entry.resolvedBy]) anchors[entry.id] = anchors[entry.resolvedBy];
    }
    return { changed, unverified, anchors };
  }
  const compareLogs = (a, b) => (a.move ?? Number.MAX_SAFE_INTEGER) - (b.move ?? Number.MAX_SAFE_INTEGER) || a.position - b.position || (a.rank || 0) - (b.rank || 0);
  function replayLogs(tracker, entries, current) {
    const cranes = new Set();
    const partners = new Map(), rollbacks = new Set();
    const cancelledAnchors = new Set(entries.filter(log => log.cancelled).map(log => JSON.stringify([log.move, log.position])));
    let setup = Object.keys(tracker.players).every(name => tracker.total(name) === 0);
    const freePlacements = new Set();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.cancelled || entry.rollbackResolved) continue;
      let event = entry.event;
      if (!event) continue;
      if (event.type === 'set' && entry.rank > 0 && cancelledAnchors.has(JSON.stringify([entry.move, entry.position]))) continue;
      if (setup && event.type === 'build' && event.free && entry.move != null) freePlacements.add(JSON.stringify([entry.move, event.player]));
      else if (!['unresolved', 'turnEnd'].includes(event.type)) setup = false;
      // Older journals counted Spy's progress-card theft as a resource transfer.
      if (event.type === 'steal' && /发展卡|进步卡|(?:progress|development) cards?/i.test(entry.source || entry.text || '')) continue;
      // Wedding transfers two cards (or the victim's remaining hand), even
      // when their types are private. Apply this to saved journals as well.
      if (event.type === 'steal' && !event.resources && /^(?:联姻|Wedding)\s*[:：]/i.test(entry.source || entry.text || '')) {
        if (!tracker.unresolved(event.victim)) event = { ...event, resources: { unknown: Math.min(2, tracker.total(event.victim)) } };
      }
      if (event.type === 'trade' || event.type === 'steal') {
        const other = event.other || event.victim;
        for (const [a, b] of [[event.player, other], [other, event.player]]) {
          if (!partners.has(a)) partners.set(a, new Set());
          partners.get(a).add(b);
        }
      }
      if (event.type === 'unresolved' && /回滚操作|取消了他的行动|undo|roll.?back/i.test(entry.source || entry.text || '')) {
        const rollbackKey = entry.move == null ? null : JSON.stringify([entry.move, event.player]);
        if (setup && rollbackKey && freePlacements.has(rollbackKey)) continue;
        // Cancelling Diplomat before any paid resource action only restores
        // the card/road selection; it cannot change a resource hand.
        if (entry.move != null) {
          const sameMove = entries.filter(log => log.move === entry.move);
          const diplomat = sameMove.some(log => {
            const source = log.source || log.text || '';
            return source.startsWith(event.player) && /^(?:打出了\s*外交官|played\s+(?:a\s+)?Diplomat)\s*[.!。]?$/i.test(source.slice(event.player.length).trim());
          });
          const noResourceAction = sameMove.every(log => log.event
            ? log.event.type === 'unresolved' || log.event.type === 'turnEnd' || (log.event.type === 'build' && log.event.free)
            : !/\{[a-z]+\}/i.test(log.source || ''));
          if (diplomat && noResourceAction) continue;
        }
        if (rollbackKey && rollbacks.has(rollbackKey)) continue;
        if (rollbackKey) rollbacks.add(rollbackKey);
        event = { ...event, affected: [event.player, ...(partners.get(event.player) || [])] };
      }
      if (event.type === 'crane') { cranes.add(event.player); continue; }
      if (event.type === 'turnEnd') { cranes.delete(event.player); partners.clear(); continue; }
      if (event.type === 'improvement') {
        const cost = Math.max(0, event.level - (cranes.has(event.player) ? 1 : 0));
        cranes.delete(event.player);
        tracker.apply({ type: 'loss', player: event.player, resources: { [event.resource]: cost } });
        continue;
      }
      const next = entries[i + 1];
      // An adjacent private gain in the same move reveals our public hidden theft.
      if (event.type === 'steal' && event.player === current && event.resources?.unknown
          && entry.move != null && next?.move === entry.move
          && !next.cancelled && !next.rollbackResolved
          && next.event?.type === 'gain' && next.event.player === current
          && !next.event.resources.unknown
          && Object.values(next.event.resources).reduce((a, b) => a + b, 0) === event.resources.unknown) {
        tracker.apply({ ...event, resources: next.event.resources });
        i++;
      } else tracker.apply(event);
    }
  }
  Object.assign(globalThis.Caton, { prepareLogs, mergeLogs, compareLogs, replayLogs });
})();

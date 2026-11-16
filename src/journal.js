(() => {
  'use strict';
  const isRollback = log => log.event?.type === 'unresolved' && /回滚操作|roll.?back|\bundo\b/i.test(log.source || log.text || '');
  function rollbackStart(entries, undo) {
    const start = entries.findIndex(log => !log.cancelled && !log.rollbackResolved && log.move === undo.move
      && !['unresolved', 'turnEnd'].includes(log.event?.type));
    if (start >= 0) return start;
    // A second undo may return to an already restored checkpoint whose original
    // action is cancelled. Its replacement actions still belong to that suffix.
    const checkpoint = entries.findLastIndex(log => !log.cancelled && log.rollbackResolved && log.move === undo.move);
    return checkpoint >= 0 && checkpoint + 1 < entries.length ? checkpoint + 1 : -1;
  }
  function resolveRollbacks(entries) {
    let changed = false;
    // A rollback notification carries the restored move number. Notifications
    // before it can belong to later moves that have now been undone. Resolve
    // this in DOM notification order, before sorting by move for replay.
    for (let i = 0; i < entries.length; i++) {
      const undo = entries[i];
      if (undo.move == null || undo.cancelled || !isRollback(undo)) continue;
      const confirmation = entries[i + 1];
      const confirmed = confirmation?.move === undo.move && confirmation.event?.type === 'unresolved'
        && confirmation.event.player === undo.event.player && /取消了他的行动/i.test(confirmation.source || confirmation.text || '');
      const start = rollbackStart(entries.slice(0, i), undo);
      const previous = entries[i - 1];
      // Cancelling an uncommitted selection emits no resource action. Require
      // the adjacent notification from the preceding move and confirmation;
      // a truncated history must not look like an empty rollback.
      const adjacent = undo.originPage != null
        ? previous?.originPage === undo.originPage && previous.originId === undo.originId - 1
        : previous?.id === undo.id - 1;
      const empty = start < 0 && confirmed && previous?.move === undo.move - 1 && adjacent;
      if (undo.rollbackNeedsHistory) continue;
      if (!empty && (start < 0 || entries.slice(start, i).some(log => !log.cancelled && (log.move == null || log.move < undo.move || log.event?.type === 'turnEnd')))) continue;
      if (start >= 0) for (const log of entries.slice(start, i)) {
        if (log.cancelled) continue;
        log.cancelled = true;
        log.cancelledById = undo.id;
        if (undo.key) log.cancelledBy = undo.key;
        changed = true;
      }
      if (!undo.rollbackResolved) { undo.rollbackResolved = true; changed = true; }
      if (confirmed && !confirmation.rollbackResolved) { confirmation.rollbackResolved = true; changed = true; }
    }
    return changed;
  }
  function prepareLogs(incoming) {
    const entries = incoming.map(entry => ({ ...entry, event: entry.event && { ...entry.event } }));
    resolveRollbacks(entries);
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
    let changed = restoreTimeline(logs), unverified = false;
    const ambiguous = new Set(), ambiguousMarkers = new Set();
    incoming = [...new Map(incoming.map(entry => [entry.id, entry])).values()];
    const signatureOf = entry => JSON.stringify([entry.move, entry.source || entry.event || entry.text]);
    const reserved = new Set(Object.keys(logs)), claimed = new Set();
    function keyFor(entry) {
      if (!Number.isSafeInteger(entry.move) || entry.move < 0) return `page:${page}:${entry.id}`;
      const signature = signatureOf(entry);
      const variants = Object.values(logs).filter(log => {
        if (log.signature !== signature || claimed.has(log.key) || !!log.cancelled !== !!entry.cancelled
          || (entry.cancelledBy && log.cancelledBy !== entry.cancelledBy) || (entry.rollbackOf && log.rollbackOf !== entry.rollbackOf)) return false;
        if (isRollback(entry) && (log.observedPage !== page || log.ambiguousPage === page)) {
          const later = Object.values(logs).filter(other => !other.cancelled && other.sequence > log.sequence);
          const active = later.filter(other => !other.rollbackResolved);
          const before = incoming.slice(0, incoming.indexOf(entry));
          const after = incoming.slice(incoming.indexOf(entry) + 1);
          const witnessedAfter = active.some(other => after.some(next => !next.cancelled && signatureOf(next) === signatureOf(other)));
          if (witnessedAfter && log.ambiguousPage) { delete log.ambiguousPage; delete log.ambiguousPlayers; changed = true; }
          if (!later.some(other => other.event?.type === 'turnEnd')) {
            if (active.some(other => before.some(prior => !prior.cancelled && signatureOf(prior) === signatureOf(other)))) return false;
            if (active.length && !witnessedAfter) {
              ambiguous.add(entry.event.player); ambiguousMarkers.add(log.key); unverified = true;
              const affected = new Set([entry.event.player]);
              for (const other of active) if (other.event && !['unresolved', 'turnEnd'].includes(other.event.type)) {
                for (const player of [other.event.player, other.event.other, other.event.victim].filter(Boolean)) { ambiguous.add(player); affected.add(player); }
              }
              log.ambiguousPlayers = [...affected];
              if (log.ambiguousPage !== page) { log.ambiguousPage = page; changed = true; }
            }
          }
        }
        return true;
      }).sort(compareLogs);
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
    const undoKeys = new Map();
    for (const entry of incoming) {
      if (entry.cancelled || (!entry.rollbackResolved && !isRollback(entry))) continue;
      const key = keyFor(entry);
      undoKeys.set(entry.id, key);
      if (isRollback(entry)) {
        const confirmation = incoming[incoming.indexOf(entry) + 1];
        if (confirmation?.move === entry.move && confirmation.event?.player === entry.event.player && /取消了他的行动/.test(confirmation.source || confirmation.text || '')) confirmation.rollbackOf = key;
      }
    }
    // Resolve a newly observed rollback against the archived active suffix
    // before matching replacement actions. Otherwise an identical redo after
    // refresh could reuse the still-active key of the road being cancelled.
    for (const undo of incoming.filter(isRollback)) {
      const undoKey = undoKeys.get(undo.id);
      if (!undoKey || undo.cancelled || ambiguousMarkers.has(undoKey)) continue;
      const oldUndo = logs[undoKey];
      const before = Object.values(logs).filter(log => !oldUndo || log.sequence < oldUndo.sequence).sort((a, b) => a.sequence - b.sequence);
      const start = rollbackStart(before, undo);
      if (start < 0 || before.slice(start).some(log => !log.cancelled && (log.move == null || log.move < undo.move || log.event?.type === 'turnEnd'))) continue;
      for (const log of before.slice(start)) {
        if (log.cancelled) continue;
        log.cancelled = true; log.cancelledBy = undoKey; changed = true;
      }
      for (const log of before) if (log.ambiguousPage && log.event?.player === undo.event.player && log.move >= undo.move) {
        delete log.ambiguousPage; delete log.ambiguousPlayers; changed = true;
      }
      undo.rollbackResolved = true;
      const confirmation = incoming[incoming.indexOf(undo) + 1];
      if (confirmation?.move === undo.move && confirmation.event?.player === undo.event.player && /取消了他的行动/.test(confirmation.source || confirmation.text || '')) confirmation.rollbackResolved = true;
    }
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
    const timeline = Object.values(logs).sort((a, b) => a.sequence - b.sequence).map(log => log.key);
    for (let i = 0; i < incomingKeys.length; i++) {
      const entry = incomingKeys[i];
      const ephemeralKey = `page:${page}:${entry.id}`;
      if (entry.stable && logs[ephemeralKey]) {
        const index = timeline.indexOf(ephemeralKey);
        if (index >= 0) timeline[index] = entry.key;
        delete logs[ephemeralKey];
        changed = true;
      }
      if (logs[entry.key]) {
        const existing = logs[entry.key];
        for (const flag of ['cancelled', 'rollbackResolved']) {
          if (entry[flag] && !existing[flag]) { existing[flag] = true; changed = true; }
        }
        if (entry.cancelledBy && existing.cancelledBy !== entry.cancelledBy) { existing.cancelledBy = entry.cancelledBy; changed = true; }
        if (entry.rollbackOf && existing.rollbackOf !== entry.rollbackOf) { existing.rollbackOf = entry.rollbackOf; changed = true; }
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
      logs[entry.key] = { ...entry, position, originPage: page, originId: entry.id, observedPage: page, observedId: entry.id };
      if (!timeline.includes(entry.key)) {
        const priorKey = incomingKeys.slice(0, i).reverse().find(log => timeline.includes(log.key))?.key;
        const nextKey = incomingKeys.slice(i + 1).find(log => timeline.includes(log.key))?.key;
        const index = nextKey ? timeline.indexOf(nextKey) : priorKey ? timeline.indexOf(priorKey) + 1 : timeline.length;
        timeline.splice(index, 0, entry.key);
      }
      changed = true;
    }
    timeline.forEach((key, sequence) => {
      if (logs[key].sequence !== sequence) { logs[key].sequence = sequence; changed = true; }
    });
    if (resolveRollbacks(timeline.map(key => logs[key]))) changed = true;
    const anchors = Object.fromEntries(incomingKeys.map(entry => [entry.id, { move: entry.move, position: logs[entry.key].position }]));
    for (const entry of incomingKeys) {
      if (entry.resolvedBy != null && anchors[entry.resolvedBy]) anchors[entry.id] = anchors[entry.resolvedBy];
    }
    for (const log of Object.values(logs)) if (log.ambiguousPage) {
      ambiguousMarkers.add(log.key); unverified = true;
      for (const player of log.ambiguousPlayers || [log.event.player]) ambiguous.add(player);
    }
    const ambiguityAnchors = [...ambiguousMarkers].map(key => ({ move: logs[key].move, position: logs[key].position,
      event: { type: 'unresolved', player: logs[key].event.player, affected: [...ambiguous], message: '撤销前后历史不完整，无法确定当前分支。' } }));
    return { changed, unverified, anchors, ambiguous: [...ambiguous], ambiguityAnchors };
  }
  function restoreTimeline(logs) {
    let metadataChanged = false;
    for (const [key, log] of Object.entries(logs)) {
      if (log.key !== key) { log.key = key; metadataChanged = true; }
      if (!log.signature) { log.signature = JSON.stringify([log.move, log.source || log.event || log.text]); metadataChanged = true; }
    }
    const values = Object.values(logs);
    if (values.every(log => Number.isSafeInteger(log.sequence))) return metadataChanged;
    const ordered = values.sort(compareLogs);
    const moveBefore = (block, undo) => {
      for (const log of block) ordered.splice(ordered.indexOf(log), 1);
      ordered.splice(ordered.indexOf(undo), 0, ...block);
    };
    // Pre-timeline journals retain same-move insertion positions and the last
    // page's notification IDs. Recover only a witnessed, contiguous old branch;
    // never sort unrelated page-local IDs as if they were global timestamps.
    for (const undo of values.filter(isRollback)) {
      const confirmation = ordered.find(log => log.move === undo.move && log.position === undo.position + 1 && log.event?.player === undo.event.player && /取消了他的行动/.test(log.source || log.text || ''));
      if (confirmation) confirmation.rollbackOf = undo.key;
      const cancelled = ordered.filter(log => log.cancelledBy === undo.key);
      if (cancelled.length) moveBefore(cancelled, undo);
      const target = ordered.find(log => !log.cancelled && log.move === undo.move && log.position < undo.position
        && !['unresolved', 'turnEnd'].includes(log.event?.type));
      if (!target) continue;
      const branch = values.filter(log => log.observedPage === target.observedPage && log.observedId >= target.observedId
        && log.id < undo.id).sort((a, b) => a.observedId - b.observedId);
      const complete = branch[0] === target && branch.at(-1)?.observedId === undo.id - 1
        && branch.every((log, i) => log.id === log.observedId && (!i || log.observedId === branch[i - 1].observedId + 1)
          && log.move >= undo.move && log.event?.type !== 'turnEnd' && !log.cancelled);
      if (complete) moveBefore(branch, undo);
      else {
        undo.rollbackNeedsHistory = true;
        undo.rollbackResolved = false;
        if (confirmation) confirmation.rollbackResolved = false;
      }
    }
    ordered.forEach((log, sequence) => {
      log.sequence = sequence;
      log.originPage = log.observedPage;
      log.originId = log.observedId;
    });
    resolveRollbacks(ordered);
    return values.length > 0;
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

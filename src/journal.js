(() => {
  'use strict';
  // BGA log_N is page-local. Only data-move-id survives a page reload.
  function mergeLogs(logs, incoming, page) {
    let changed = false, unverified = false;
    incoming = [...new Map(incoming.map(entry => [entry.id, entry])).values()];
    const occurrences = new Map();
    const incomingKeys = incoming.map(entry => {
      const stable = Number.isSafeInteger(entry.move) && entry.move >= 0;
      if (!stable) unverified = true;
      const signature = JSON.stringify([entry.move, entry.event || entry.text]);
      const occurrence = (occurrences.get(signature) || 0) + 1;
      occurrences.set(signature, occurrence);
      const key = stable ? `${signature}:${occurrence}` : `page:${page}:${entry.id}`;
      return { ...entry, stable, key, signature };
    });
    for (const entry of incomingKeys) {
      if (entry.stable && Object.values(logs).filter(log => log.signature === entry.signature).length > occurrences.get(entry.signature)) unverified = true;
    }
    for (let i = 0; i < incomingKeys.length; i++) {
      const entry = incomingKeys[i];
      if (logs[entry.key]) continue;
      const prior = incomingKeys.slice(0, i).reverse().find(log => log.move === entry.move && logs[log.key]);
      const next = incomingKeys.slice(i + 1).find(log => log.move === entry.move && logs[log.key]);
      const previousPosition = prior ? logs[prior.key].position : undefined;
      const nextPosition = next ? logs[next.key].position : undefined;
      const position = previousPosition !== undefined && nextPosition !== undefined ? (previousPosition + nextPosition) / 2
        : nextPosition !== undefined ? nextPosition - 1
        : previousPosition !== undefined ? previousPosition + 1
        : Math.max(0, ...Object.values(logs).filter(log => log.move === entry.move).map(log => log.position)) + 1;
      logs[entry.key] = { ...entry, position };
      changed = true;
    }
    return { changed, unverified };
  }
  const compareLogs = (a, b) => (a.move ?? Number.MAX_SAFE_INTEGER) - (b.move ?? Number.MAX_SAFE_INTEGER) || a.position - b.position || (a.rank || 0) - (b.rank || 0);
  function replayLogs(tracker, entries, current) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], event = entry.event;
      if (!event) continue;
      const next = entries[i + 1];
      // An adjacent private gain in the same move reveals our public hidden theft.
      if (event.type === 'steal' && event.player === current && event.resources.unknown
          && entry.move != null && next?.move === entry.move
          && next.event?.type === 'gain' && next.event.player === current
          && !next.event.resources.unknown
          && Object.values(next.event.resources).reduce((a, b) => a + b, 0) === event.resources.unknown) {
        tracker.apply({ ...event, resources: next.event.resources });
        i++;
      } else tracker.apply(event);
    }
  }
  Object.assign(globalThis.Caton, { mergeLogs, compareLogs, replayLogs });
})();

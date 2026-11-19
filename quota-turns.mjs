// Account observations for turns that started after this collector was enabled.
export const boundaryAge = 180_000;
export const endGrace = 12_000;
const resetDrift = 10 * 60_000;

export function turnSeries(samples) {
  const points = [];
  let previous;
  let correctedAt = -Infinity;
  let disputedHigh = 0;
  for (let index = 0; index < samples.length; index++) {
    let sample = samples[index];
    while (samples[index + 1]?.at === sample.at) {
      const simultaneous = samples[++index];
      if (simultaneous.origin === 'official' || sample.origin !== 'official') sample = simultaneous;
    }
    let edge = 'same';
    const official = sample.origin === 'official';
    if (sample.available && sample.resetAt <= sample.at) continue;
    if (!sample.available || !previous?.available) {
      // Only an account query can immediately reverse an explicit change in plan.
      if (!official && previous?.origin === 'official' && sample.available !== previous.available &&
          sample.at - previous.at < 60_000) continue;
      edge = 'break';
    } else if (Math.abs(sample.resetAt - previous.resetAt) > resetDrift) {
      if (sample.at >= previous.resetAt && sample.resetAt > previous.resetAt) {
        edge = 'renewed';
      } else if (official) {
        edge = 'break';
      } else {
        continue;
      }
    } else if (sample.used < previous.used) {
      if (!official || (Number.isFinite(sample.requestedAt) && previous.at > sample.requestedAt)) continue;
      edge = 'correction';
      disputedHigh = Math.max(previous.used, sample.at - correctedAt < 60_000 ? disputedHigh : 0);
      correctedAt = sample.at;
    } else if (!official && sample.at - correctedAt < 60_000 &&
               sample.used > previous.used && sample.used <= disputedHigh) {
      continue;
    }
    if (edge === 'break' || edge === 'renewed') correctedAt = -Infinity;
    previous = {...sample, edge};
    points.push(previous);
  }
  return points;
}

function after(points, at) {
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].at <= at) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function measureTurn(points, task, now, postEndLimit, duration) {
  const end = task.end ?? now;
  const begin = after(points, task.start);
  const stop = after(points, end);
  const before = points[begin - 1];
  const interval = points.slice(begin, stop);
  const tail = interval.at(-1) ?? before;
  let followup = null;
  if (task.end != null && task.status !== 'unknown' && !(interval.length && tail.at >= end - 1000)) {
    for (let i = stop; i < points.length; i++) {
      const p = points[i];
      if (p.at > end + endGrace || p.at >= postEndLimit || !p.available || p.edge !== 'same' || !(tail?.resetAt > p.at)) break;
      if (p.origin === 'official' && Number.isFinite(p.requestedAt) && p.requestedAt >= end) {
        followup = p;
        break;
      }
    }
  }
  const first = interval[0] ?? followup;
  // A matching in-turn observation corroborates an older baseline in the same cycle.
  const unchanged = first?.available && first.edge === 'same' && first.used === before?.used;
  const anchored = before?.available && before.resetAt >= task.start &&
    (task.start - before.at <= boundaryAge || unchanged);
  let previous = anchored ? before : null;
  let base = previous?.used ?? 0, total = 0, pairs = 0;
  let fromAt = previous?.at ?? null, toAt = null, lastAvailable = before?.available;
  const notes = new Set();
  if (!anchored) notes.add('start');
  if (followup) {
    if (!interval.length || tail.used !== followup.used) notes.add('after-end');
    interval.push(followup);
  }
  for (const point of interval) {
    lastAvailable = point.available;
    if (!point.available || (previous && point.edge === 'break')) {
      if (previous) total += Math.max(0, previous.used - base);
      previous = null;
      notes.add('interrupted');
      if (!point.available) continue;
    }
    if (!previous) {
      base = point.used;
      fromAt ??= point.at;
      if (point === first && point.edge === 'renewed' && before?.available && before.resetAt >= task.start) {
        base = 0;
        pairs++;
        notes.add('reset-gap');
      }
    } else if (point.edge === 'renewed') {
      total += Math.max(0, previous.used - base);
      base = 0;
      if (previous.used !== 100 || point.at - previous.resetAt >= duration) notes.add('reset-gap');
      pairs++;
    } else {
      if (point.edge === 'correction') notes.add('correction');
      pairs++;
    }
    previous = point;
    toAt = point.at;
  }
  if (!pairs) {
    const reason = lastAvailable === false ? 'unavailable' : task.end == null ? 'pending' : 'missing';
    return {percent:null, reason, fromAt, toAt, notes:[]};
  }
  if (end - toAt > boundaryAge || task.status === 'unknown' || (previous && previous.resetAt <= end)) notes.add('end');
  if (previous) total += Math.max(0, previous.used - base);
  return {percent:total, reason:null, fromAt, toAt, notes:[...notes]};
}

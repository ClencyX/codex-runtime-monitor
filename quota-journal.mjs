import fs from 'node:fs';
import path from 'node:path';

const retention = 8 * 86_400_000;
const dateName = at => new Date(at).toISOString().slice(0, 10);

// This cache contains quota observations and turn boundaries, never prompts or tool output.
export class QuotaJournal {
  constructor(home, now) {
    this.dir = path.join(home, 'cache', 'codex-runtime-monitor', 'quota-v2');
    this.since = now;
    this.error = false;
    this.day = '';
    try {
      fs.mkdirSync(this.dir, {recursive:true});
      const marker = path.join(this.dir, 'enabled-at');
      try { fs.writeFileSync(marker, String(now), {flag:'wx'}); }
      catch (error) { if (error.code !== 'EEXIST') { this.error = true; return; } }
      const saved = Number.parseInt(fs.readFileSync(marker, 'utf8'), 10);
      if (!Number.isSafeInteger(saved) || saved <= 0) { this.error = true; return; }
      this.since = saved;
    } catch { this.error = true; }
  }

  files(now) {
    const earliest = dateName(now - retention);
    const days = fs.readdirSync(this.dir).filter(n => /^\d{4}-\d\d-\d\d\.jsonl$/.test(n));
    for (const day of days.filter(n => n.slice(0, 10) < earliest)) fs.unlinkSync(path.join(this.dir, day));
    this.day = dateName(now);
    return days.filter(n => n.slice(0, 10) >= earliest).sort();
  }

  restore(now, consume) {
    try {
      for (const name of this.files(now)) {
        for (const line of fs.readFileSync(path.join(this.dir, name), 'utf8').split('\n')) {
          if (!line) continue;
          try { consume(JSON.parse(line)); } catch { this.error = true; }
        }
      }
    } catch { this.error = true; }
  }

  append(at, record, now) {
    if (at < this.since || at < now - retention) return;
    try {
      if (dateName(now) !== this.day) this.files(now);
      // A leading newline also isolates a truncated last record following an unclean exit.
      fs.appendFileSync(path.join(this.dir, dateName(at) + '.jsonl'), '\n' + JSON.stringify(record));
    } catch { this.error = true; }
  }
}

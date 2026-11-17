/**
 * C8: package-owned ledger in ctx.dataDir. One async write queue, atomic tmp -> rename,
 * Windows rename contention retry (V4-BLK-06), and a per-group live-record ceiling.
 * No network access, no secret access, no host event deletion.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AddResult, ClassifySuggestion, GroupRec, ListQuery, RecordRec,
  StoreApi, StoreStats, UpdatePatch,
} from './types.ts';
import { MAX_ACTIVE_RECORDS } from './types.ts';

const RECORDS = 'qq-digest.records.jsonl';
const GROUPS = 'qq-digest.groups.json';
const COUNTERS = 'qq-digest.counters.json';
const ARCHIVE = 'qq-digest.archive.jsonl';

const ts = (): string => new Date().toISOString();

function dedupKey(r: Pick<RecordRec, 'conv' | 'message_id' | 'category' | 'content'>): string {
  const h = createHash('sha256').update(r.content).digest('hex').slice(0, 12);
  return `${r.conv}|${r.message_id}|${r.category}|${h}`;
}

/** C8: write tmp in the same directory, then rename. On failure keep both files. */
function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw err;
      // Windows rename contention: keep tmp and the original file as-is, no data loss.
      if (attempt === 4) throw err;
    }
  }
}

function readJsonArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

export class RecordStore implements StoreApi {
  private records: RecordRec[] = [];
  /** Kept distinct from the public groups() method (C1). */
  private groupRows: GroupRec[] = [];
  private nextId = 1;
  private lastReview = '';
  /** C8: single async write queue — no concurrent overwrite. */
  private queue: Promise<void> = Promise.resolve();
  private readonly maxActive: number;

  constructor(private readonly dataDir: string, maxActive = MAX_ACTIVE_RECORDS) {
    this.maxActive = maxActive;
  }

  async load(): Promise<void> {
    this.records = readJsonArray<RecordRec>(join(this.dataDir, RECORDS));
    const rawGroups = join(this.dataDir, GROUPS);
    if (existsSync(rawGroups)) {
      const parsed = JSON.parse(readFileSync(rawGroups, 'utf8')) as GroupRec[];
      this.groupRows = Array.isArray(parsed) ? parsed : [];
    }
    const counters = join(this.dataDir, COUNTERS);
    if (existsSync(counters)) {
      const c = JSON.parse(readFileSync(counters, 'utf8')) as { nextId?: number; lastReview?: string };
      this.nextId = c.nextId ?? (this.records.reduce((m, r) => Math.max(m, r.id), 0) + 1);
      this.lastReview = c.lastReview ?? '';
    } else {
      this.nextId = this.records.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    }
  }

  private enqueue(fn: () => void): Promise<void> {
    const next = this.queue.then(() => { fn(); });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private persist(): void {
    atomicWrite(join(this.dataDir, RECORDS), `${this.records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    atomicWrite(join(this.dataDir, GROUPS), JSON.stringify(this.groupRows, null, 2));
    atomicWrite(join(this.dataDir, COUNTERS), JSON.stringify({ nextId: this.nextId, lastReview: this.lastReview }, null, 2));
  }

  /** C1: create-or-read a group, always closed by default. */
  private ensureGroup(conv: string): GroupRec {
    let g = this.groupRows.find((x) => x.conv === conv);
    if (!g) {
      g = {
        conv, enabled: false, provenance: 'suggested', updated_at: ts(),
        suggested: { kind: 'unknown', confidence: 0, reasons: ['no evidence yet'] },
      };
      this.groupRows.push(g);
    }
    return g;
  }

  getGroup(conv: string): GroupRec | undefined {
    return this.groupRows.find((x) => x.conv === conv);
  }

  groups(): GroupRec[] { return [...this.groupRows]; }

  /** C1: advisory only; never writes enabled. */
  async suggestGroup(conv: string, s: ClassifySuggestion, name?: string): Promise<GroupRec> {
    const g = this.ensureGroup(conv);
    await this.enqueue(() => {
      g.suggested = s;
      if (name !== undefined) g.name = name;
      g.updated_at = ts();
      this.persist();
    });
    return { ...g, suggested: { ...g.suggested, reasons: [...g.suggested.reasons] } };
  }

  /** C1: enabled=true only from a panel invoke (or a human-approved model request). */
  async setGroupEnabled(conv: string, enabled: boolean): Promise<GroupRec> {
    const g = this.ensureGroup(conv);
    await this.enqueue(() => {
      g.enabled = enabled;
      g.provenance = 'manual';
      g.updated_at = ts();
      this.persist();
    });
    return { ...g, suggested: { ...g.suggested, reasons: [...g.suggested.reasons] } };
  }

  /** C3: package-side dedup; a repeat call returns `duplicate of #<id>`. */
  async add(input: Omit<RecordRec, 'id' | 'dedup' | 'done'>): Promise<AddResult> {
    const g = this.getGroup(input.conv);
    if (!g || !g.enabled) return { ok: false, reason: 'group-disabled' };
    const dedup = dedupKey(input);
    const dup = this.records.find((r) => r.dedup === dedup);
    if (dup) return { ok: false, reason: 'duplicate', duplicateOf: dup.id };
    const record: RecordRec = { ...input, id: this.nextId, done: false, dedup };
    await this.enqueue(() => {
      this.nextId += 1;
      this.records.push(record);
      // C8: GUESS starting value; archive oldest per conv beyond the ceiling.
      const same = this.records.filter((r) => r.conv === input.conv);
      if (same.length > this.maxActive) {
        const drop = same.slice(0, same.length - this.maxActive).map((r) => r.id);
        const path = join(this.dataDir, ARCHIVE);
        const archived = `${same.slice(0, same.length - this.maxActive).map((r) => JSON.stringify(r)).join('\n')}\n`;
        writeFileSync(path, (existsSync(path) ? readFileSync(path, 'utf8') : '') + archived, 'utf8');
        this.records = this.records.filter((r) => !drop.includes(r.id));
      }
      this.persist();
    });
    return { ok: true, record: { ...record } };
  }

  async update(id: number, patch: UpdatePatch): Promise<RecordRec | null> {
    const target = this.records.find((r) => r.id === id);
    if (!target) return null;
    await this.enqueue(() => {
      if (patch.content !== undefined) target.content = patch.content;
      if (patch.category !== undefined) target.category = patch.category;
      if (patch.done !== undefined) target.done = patch.done;
      target.updated_at = ts();
      target.dedup = dedupKey(target);
      this.persist();
    });
    return { ...target };
  }

  async remove(id: number): Promise<boolean> {
    if (!this.records.some((r) => r.id === id)) return false;
    await this.enqueue(() => {
      this.records = this.records.filter((r) => r.id !== id);
      this.persist();
    });
    return true;
  }

  list(q: ListQuery = {}): RecordRec[] {
    const limit = q.limit === undefined ? 100 : Math.max(1, Math.min(1000, q.limit));
    return this.records
      .filter((r) => (q.conv === undefined || r.conv === q.conv))
      .filter((r) => (q.category === undefined || r.category === q.category))
      .slice().sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
  }

  stats(): StoreStats {
    const bytes = [RECORDS, GROUPS, COUNTERS, ARCHIVE].reduce((sum, f) => {
      const p = join(this.dataDir, f);
      return sum + (existsSync(p) ? statSync(p).size : 0);
    }, 0);
    return {
      records: this.records.length,
      groups: this.groupRows.length,
      pendingGroups: this.groupRows.filter((g) => !g.enabled && g.suggested.kind === 'work').length,
      pendingRecords: this.records.filter((r) => !r.done).length,
      bytes,
    };
  }

  /** C8: Core allows only 20s for stop(); flush is bounded by the caller. */
  async flush(): Promise<void> {
    await this.queue;
  }

  /** C9: StoragePart.clear — package-owned files only; host event store is untouched. */
  async clear(): Promise<void> {
    await this.enqueue(() => {
      this.records = [];
      this.groupRows = [];
      this.nextId = 1;
      for (const f of [RECORDS, GROUPS, COUNTERS, ARCHIVE]) {
        const p = join(this.dataDir, f);
        if (existsSync(p)) unlinkSync(p);
      }
    });
  }

  markReview(): Promise<void> {
    return this.enqueue(() => { this.lastReview = ts(); this.persist(); });
  }

  reviewCursor(): string { return this.lastReview || '(never)'; }
}

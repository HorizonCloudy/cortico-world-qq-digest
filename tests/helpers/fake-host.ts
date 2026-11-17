import type { WorldHost } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { QQD_DEFAULTS, type QqDigestConfigSection } from '../../src/config.ts';
import { RecordStore } from '../../src/store.ts';
import type { RangeQuery, ToolsDeps } from '../../src/tools.ts';
import type { IngestEvent } from '../../src/types.ts';
import { tempDataDir } from './tmpdir.ts';

/** Fixed clock so fromTs/toTs and receipts are deterministic. */
export const NOW = '2026-11-18T02:00:00.000Z';

export function fakeWorldContext(dataDir: string): WorldContext<QqDigestConfigSection> {
  return {
    id: 'qq-digest',
    cfg: { ...QQD_DEFAULTS },
    timezone: 'Asia/Shanghai',
    botName: 'test-bot',
    botDir: dataDir,
    packageDir: dataDir,
    dataDir,
    repoRoot: dataDir,
    secret: () => '',
    storeSecret: () => {},
    persist: () => {},
    restart: async () => {},
  };
}

export interface FakeWorldHost {
  host: WorldHost;
  pushed: Array<Record<string, unknown>>;
  rangeCalls: Array<Record<string, unknown>>;
  setEvents(events: readonly IngestEvent[]): void;
}

export function fakeWorldHost(initial: readonly IngestEvent[] = []): FakeWorldHost {
  const pushed: Array<Record<string, unknown>> = [];
  const rangeCalls: Array<Record<string, unknown>> = [];
  let events: IngestEvent[] = [...initial];
  const host = {
    pushEvent: async (e: Record<string, unknown>) => {
      pushed.push(e);
      return { ...e, cursor: pushed.length };
    },
    store: {
      range: (q: Record<string, unknown>) => {
        rangeCalls.push(q);
        return events;
      },
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as WorldHost;
  return {
    host,
    pushed,
    rangeCalls,
    setEvents: (next) => { events = [...next]; },
  };
}

export interface ToolsHarness {
  dir: string;
  store: RecordStore;
  deps: ToolsDeps;
  audits: Array<{ type: string; text: string }>;
  ranges: RangeQuery[];
  setEvents(events: readonly IngestEvent[]): void;
}

/** Real RecordStore + fake host.store.range + in-memory audit sink. */
export function makeToolsHarness(initial: readonly IngestEvent[] = []): ToolsHarness {
  const dir = tempDataDir();
  const store = new RecordStore(dir);
  const audits: Array<{ type: string; text: string }> = [];
  const ranges: RangeQuery[] = [];
  let events: IngestEvent[] = [...initial];
  const deps: ToolsDeps = {
    store,
    range: (q) => { ranges.push(q); return events; },
    audit: async (type, text) => { audits.push({ type, text }); },
    now: () => NOW,
  };
  return {
    dir, store, deps, audits, ranges,
    setEvents: (next) => { events = [...next]; },
  };
}

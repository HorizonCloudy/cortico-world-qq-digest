/**
 * C1 / R9: the group-nature layer is advisory only. It emits a candidate,
 * a confidence and reasons; it can never open a group. A human mark is sticky.
 */
import { describe, expect, it } from 'vitest';
import { assertAdvisoryOnly, suggestGroupNature } from '../src/classify.ts';
import type { GroupRec, IngestEvent } from '../src/types.ts';

const manualPrior: GroupRec = {
  conv: 'qq-official.group:G1',
  enabled: false,
  provenance: 'manual',
  updated_at: '2026-11-18T00:00:00.000Z',
  suggested: { kind: 'chat', confidence: 1, reasons: ['human marked as chat'] },
};

const events: readonly IngestEvent[] = Array.from({ length: 24 }, (_, i) => ({
  source: 'qq-official.message',
  senderKey: 'qq-official.group:G1',
  meta: { message_id: `M-${i}`, kind: 'group' },
  text: 'hello',
}));

describe('advisory-only shape (C1)', () => {
  it('output has exactly kind / confidence / reasons and no enabled field', () => {
    const s = suggestGroupNature({ conv: 'c', groupName: '项目交付群', events });
    expect(Object.keys(s).sort()).toEqual(['confidence', 'kind', 'reasons']);
    expect('enabled' in s).toBe(false);
    expect(() => assertAdvisoryOnly(s)).not.toThrow();
  });

  it('assertAdvisoryOnly rejects any output that carries enabled', () => {
    const polluted = { kind: 'work' as const, confidence: 1, reasons: [], enabled: true };
    expect(() => assertAdvisoryOnly(polluted)).toThrow('classify output must not contain enabled');
  });

  it('no rule result ever sets enabled to true (open-group is a human-only action)', () => {
    for (const name of ['项目交付群', '摸鱼水群', '', '随便什么名字']) {
      const s = suggestGroupNature({ conv: 'c', groupName: name, events });
      expect((s as unknown as Record<string, unknown>).enabled).toBeUndefined();
    }
  });
});

describe('rule outcomes are coarse candidates, not decisions', () => {
  it('a work-ish name produces a work candidate with reasons and bounded confidence', () => {
    const s = suggestGroupNature({ conv: 'c', groupName: '项目交付群' });
    expect(s.kind).toBe('work');
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.confidence).toBeLessThanOrEqual(0.85);
    expect(s.reasons.join(' ')).toContain('项目');
  });

  it('a chat-ish name produces a chat candidate', () => {
    const s = suggestGroupNature({ conv: 'c', groupName: '摸鱼水群' });
    expect(s.kind).toBe('chat');
    // The rule loop reports the first matching keyword; 摸鱼水群 hits 水群 first.
    expect(s.reasons.join(' ')).toMatch(/水群|摸鱼/);
  });

  it('no usable hard signal -> unknown with low confidence', () => {
    const s = suggestGroupNature({ conv: 'c' });
    expect(s.kind).toBe('unknown');
    expect(s.confidence).toBeLessThanOrEqual(0.4);
    expect(s.reasons.join(' ')).toContain('cannot separate work from chat');
  });

  it('the conv kind trigger enum is not treated as group nature (R4/R9)', () => {
    const s = suggestGroupNature({ conv: 'qq.group:888', events });
    expect(s.kind).not.toBe('work');
    expect(s.reasons.join(' ')).toContain('group name unavailable');
  });

  it('message frequency only shifts a bucket, it never opens a group', () => {
    const low = suggestGroupNature({ conv: 'c', events: events.slice(0, 1) });
    const high = suggestGroupNature({ conv: 'c', events });
    expect(low.reasons.join(' ')).toContain('frequency bucket low');
    expect(high.reasons.join(' ')).toContain('frequency bucket high');
    expect('enabled' in high).toBe(false);
  });
});

describe('a prior human mark is sticky (C1)', () => {
  it('rules cannot overwrite a manual decision, even with obvious work signals', () => {
    const s = suggestGroupNature({
      conv: manualPrior.conv,
      groupName: '项目交付需求排期群',
      events,
      prior: manualPrior,
    });
    expect(s.kind).toBe('chat');
    expect(s.confidence).toBe(1);
    expect(s.reasons.join(' ')).toContain('sticky');
  });

  it('a suggested (non-manual) prior is still just a candidate', () => {
    const s = suggestGroupNature({
      conv: 'c',
      groupName: '项目群',
      prior: { ...manualPrior, provenance: 'suggested' },
    });
    expect(s.kind).toBe('work');
    expect(s.confidence).toBeLessThan(1);
  });
});

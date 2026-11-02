import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const row = (night: ReturnType<typeof readNight>, job: string) => night?.rows.find((r) => r.job === job);

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs and counts the 1 truncated line as bad', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows).toHaveLength(5);
    expect(night!.badLines).toBe(1);
  });

  it('summarises fixtures/refresh: 4 runs, 3 retries, last ok', () => {
    expect(row(night, 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps the last error of a failed job', () => {
    expect(row(night, 'notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', runs: 1 });
  });

  it('keeps a null owner as null', () => {
    const r = row(night, 'digest/render');
    expect(r).toBeDefined();
    expect(r!.owner).toBeNull();
  });
});

describe('readNight edge cases', () => {
  it('returns null for a missing night', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
    expect(readNight(tmp, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
  });

  it('reads an empty file as a night with no rows', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({ night: '2026-01-02', rows: [], badLines: 0 });
  });

  it('orders by time, not string, across offsets; counts invalid lines; skips blanks', () => {
    const lines = [
      // 23:30Z
      { at: '2026-01-03T00:30:00+01:00', job: 'a', status: 'retry', owner: 'x', error: 'e1' },
      // 23:00Z: earlier in time, though later as a string
      { at: '2026-01-02T23:00:00+00:00', job: 'a', status: 'ok', owner: 'y' },
      { at: '2026-01-03T00:00:00Z', job: 'a', status: 'fail', owner: 'z', error: 'e2' },
      { at: 'not a date', job: 'a', status: 'ok' },
      { at: '2026-01-03T00:00:00Z', job: 'a', status: 'done' },
      { at: '2026-01-03T00:00:00Z', status: 'ok' },
    ].map((l) => JSON.stringify(l));
    writeFileSync(join(tmp, '2026-01-03.jsonl'), [...lines, '{oops', '', '[]', ''].join('\n'));

    const n = readNight(tmp, '2026-01-03')!;
    expect(n.badLines).toBe(5);
    expect(n.rows).toEqual([
      {
        job: 'a',
        owner: 'z',
        runs: 3,
        retries: 1,
        lastStatus: 'fail',
        lastError: 'e2',
        firstAt: '2026-01-02T23:00:00+00:00',
        lastAt: '2026-01-03T00:00:00Z',
      },
    ]);
  });
});

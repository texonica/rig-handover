import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Synthetic run logs in a temp dir. runs/ is never read or written here.
let runsDir: string;

const line = (at: string, job: string, owner: string | null, status: string, error?: string) =>
  JSON.stringify({ at, job, owner, status, ...(error ? { error } : {}) });

// Built after beforeAll, so runsDir is set by the time a test asks for the app.
const app = () =>
  createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));

  // First-appearance order is deliberately not alphabetical, and one line is bad.
  writeFileSync(
    join(runsDir, '2026-10-28.jsonl'),
    [
      line('2026-10-28T01:30:00+01:00', 'notes/backup', 'rook', 'fail', 'quota exceeded'),
      line('2026-10-28T01:31:00+01:00', 'fixtures/refresh', 'rook', 'retry'),
      '{"at": "2026-10-28T01:32:00+01:00", "job": "fixtures/refresh", "stat',
      line('2026-10-28T01:33:00+01:00', 'digest/render', null, 'ok'),
      line('2026-10-28T01:34:00+01:00', 'fixtures/refresh', 'rook', 'ok'),
      '',
    ].join('\n'),
  );

  // A clean night: every line parses.
  writeFileSync(
    join(runsDir, '2026-10-27.jsonl'),
    [
      line('2026-10-27T02:00:00+01:00', 'notes/backup', 'rook', 'ok'),
      line('2026-10-27T02:05:00+01:00', 'digest/render', 'rook', 'ok'),
    ].join('\n') + '\n',
  );

  // An empty night: the file exists, no lines.
  writeFileSync(join(runsDir, '2026-10-26.jsonl'), '');
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Job names in the order they appear in the page's table body.
function jobsInPage(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, at: html.indexOf(`<td>${job}</td>`) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

describe('GET /digest/:night', () => {
  it('200 for a night with a file and lists its jobs', async () => {
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-10-28');
    for (const job of ['notes/backup', 'fixtures/refresh', 'digest/render']) {
      expect(html).toContain(`<td>${job}</td>`);
    }
  });

  it('404 for a night with no file', async () => {
    const res = await app().request('/digest/2025-01-01');
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for 2025-01-01');
  });

  it('renders "nothing ran" for the empty night', async () => {
    const res = await app().request('/digest/2026-10-26');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');
  });

  it('shows the "didn\'t parse" line for a night with a bad line', async () => {
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(html).toContain('1 line didn&#39;t parse');
  });

  it('shows no parse warning for a clean night', async () => {
    const res = await app().request('/digest/2026-10-27');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain("didn&#39;t parse");
  });

  it('lists the same jobs in the same order as the JSON', async () => {
    const page = await (await app().request('/digest/2026-10-28')).text();
    const json = (await (await app().request('/api/digest/2026-10-28')).json()) as {
      rows: { job: string }[];
    };
    const jobs = json.rows.map((r) => r.job);
    expect(jobs).toEqual(['digest/render', 'fixtures/refresh', 'notes/backup']);
    expect(jobsInPage(page, jobs)).toEqual(jobs);
  });
});

describe('GET /api/digest/:night', () => {
  it('200 for a night with a file, with the rows', async () => {
    const res = await app().request('/api/digest/2026-10-27');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string; runs: number }[]; badLines: number };
    expect(body.night).toBe('2026-10-27');
    expect(body.rows.map((r) => [r.job, r.runs])).toEqual([
      ['digest/render', 1],
      ['notes/backup', 1],
    ]);
    expect(body.badLines).toBe(0);
  });

  it('404 for a night with no file', async () => {
    const res = await app().request('/api/digest/2025-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2025-01-01' });
  });

  it('returns rows [] for the empty night', async () => {
    const res = await app().request('/api/digest/2026-10-26');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-10-26', rows: [], badLines: 0 });
  });

  it('counts the bad line in badLines', async () => {
    const res = await app().request('/api/digest/2026-10-28');
    const body = (await res.json()) as { badLines: number };
    expect(body.badLines).toBe(1);
  });
});

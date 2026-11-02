import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

type Line = {
  at: string;
  time: number; // Date.parse(at): offsets vary, so string order is not time order
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

// One log line, or null when it doesn't parse or lacks a valid at/job/status.
function parseLine(text: string): Line | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.job !== 'string' || o.job === '') return null;
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status as RunStatus)) return null;
  if (typeof o.at !== 'string') return null;
  const time = Date.parse(o.at);
  if (Number.isNaN(time)) return null;
  return {
    at: o.at,
    time,
    job: o.job,
    status: o.status as RunStatus,
    // owner is kept as logged; null stays null (views render it as '—').
    owner: typeof o.owner === 'string' ? o.owner : null,
    error: typeof o.error === 'string' ? o.error : null,
  };
}

type Acc = { row: DigestRow; firstTime: number; lastTime: number };

export const readNight: ReadNight = (runsDir, night) => {
  // Only YYYY-MM-DD reaches the filesystem: no path traversal.
  if (!NIGHT.test(night)) return null;

  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  // Insertion order of the Map = order of first appearance; views sort by job.
  const byJob = new Map<string, Acc>();
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue; // blank lines (e.g. trailing newline) are not bad
    const line = parseLine(raw);
    if (!line) {
      badLines++;
      continue;
    }

    const acc = byJob.get(line.job);
    if (!acc) {
      byJob.set(line.job, {
        row: {
          job: line.job,
          owner: line.owner,
          runs: 1,
          retries: line.status === 'retry' ? 1 : 0,
          lastStatus: line.status,
          lastError: line.error,
          firstAt: line.at,
          lastAt: line.at,
        },
        firstTime: line.time,
        lastTime: line.time,
      });
      continue;
    }

    acc.row.runs++;
    if (line.status === 'retry') acc.row.retries++;
    if (line.time < acc.firstTime) {
      acc.firstTime = line.time;
      acc.row.firstAt = line.at;
    }
    // Latest line by time wins; on a tie the later line in the file wins.
    // If the owner differs across lines, the latest line's owner is used too:
    // it says who owns the job now.
    if (line.time >= acc.lastTime) {
      acc.lastTime = line.time;
      acc.row.lastAt = line.at;
      acc.row.lastStatus = line.status;
      acc.row.lastError = line.error;
      acc.row.owner = line.owner;
    }
  }

  return { night, rows: [...byJob.values()].map((a) => a.row), badLines };
};

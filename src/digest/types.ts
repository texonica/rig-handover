// The digest contract (plan.md § 1). Section 2 builds against these types;
// the reader itself is a separate issue.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job in a night's run log.
export type DigestRow = {
  job: string;
  owner: string | null; // null is kept; views show it as '—'
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string; // the earliest `at` for this job, as logged (ISO 8601)
  lastAt: string; // the latest `at` for this job, as logged (ISO 8601)
};

// A night as read from runs/<night>.jsonl. A line that doesn't parse is
// counted in badLines, never thrown.
export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[];
  badLines: number;
};

// Returns null when runs/<night>.jsonl does not exist (the page answers 404).
// An empty file is a Night with rows: [] (the page renders "nothing ran").
export type ReadNight = (runsDir: string, night: string) => Night | null;

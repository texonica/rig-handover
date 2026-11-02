import type { DigestRow } from './types.js';

// One order for the page and the JSON (ADR 0001: they must never disagree).
export function sortRows(rows: DigestRow[]): DigestRow[] {
  return [...rows].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
}

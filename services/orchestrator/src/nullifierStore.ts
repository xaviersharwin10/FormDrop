/**
 * In-memory placeholder, same caveat as the other *Store modules. A real
 * deployment needs this in Postgres with a UNIQUE (nullifier, action)
 * constraint — an in-memory Set is fine for a demo, not for surviving a
 * restart or running more than one instance.
 */
const usedNullifiers = new Set<string>();

function key(nullifier: string, action: string): string {
  return `${nullifier}:${action}`;
}

export function isNullifierUsed(nullifier: string, action: string): boolean {
  return usedNullifiers.has(key(nullifier, action));
}

export function markNullifierUsed(nullifier: string, action: string): void {
  usedNullifiers.add(key(nullifier, action));
}

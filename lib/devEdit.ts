/**
 * Developer edits — "the developer can rewrite any entry, but it stays
 * highlighted."
 *
 * One tiny shared stamp. Any record a developer saves gets a `devEdited`
 * mark {by, at, fields}; the UI draws such records with an amber outline
 * and a "Developer edited" chip, and the mark is never cleared by a later
 * ordinary save — the fact that a developer touched it is part of its
 * history. The audit log still records the change itself.
 */
export interface DevEditMark { by: string; at: string; fields: string[]; note?: string }

export function devStamp<T extends Record<string, any>>(record: T, before: Record<string, any> | null, user: { name: string; role: string }, note?: string): T {
  if (user.role !== "developer") return record;
  const fields = before
    ? Object.keys(record).filter((k) => !["updatedAt", "devEdited"].includes(k) && JSON.stringify((record as any)[k]) !== JSON.stringify(before[k]))
    : ["created"];
  if (!fields.length) return record;
  const prev: DevEditMark | undefined = (record as any).devEdited;
  const mark: DevEditMark = { by: user.name, at: new Date().toISOString(), fields: [...new Set([...(prev?.fields || []), ...fields])].slice(0, 20), note: note || prev?.note };
  return { ...record, devEdited: mark };
}

/** Developer + override active → locks step aside (freeze, approval state, closed PO). */
export function devUnlocked(user: { role: string }, overrideActive: boolean): boolean {
  return user.role === "developer" && overrideActive;
}

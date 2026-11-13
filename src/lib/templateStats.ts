import type { Template, Workout } from '../db'
import { normalize } from './format'

/** How many of a template's last sessions its average length is taken from. */
export const SESSIONS_AVERAGED = 4

/** Sessions shorter or longer than this aren't in the average: started by mistake, or left running. */
const SHORTEST = 10 * 60_000
const LONGEST = 4 * 60 * 60_000

export interface TemplateStats {
  /** When it was last done. */
  lastUsed: number
  /** How long its last sessions took on average (up to SESSIONS_AVERAGED of them); null if none counts. */
  average: { ms: number; sessions: number } | null
}

/**
 * When each template was last done, and how long it takes, from the finished workouts done with it:
 * those started from it, and those with its name and no template of their own (imported from
 * Strong, or started from a template deleted since).
 */
export function templateStats(templates: readonly Template[], workouts: readonly Workout[]): Map<string, TemplateStats> {
  const ids = new Set(templates.map((t) => t.id))
  const finished = workouts
    .filter((w) => w.endedAt !== null)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((w) => ({ w, name: normalize(w.name.trim()), ms: w.endedAt! - w.startedAt }))
  const stats = new Map<string, TemplateStats>()
  for (const t of templates) {
    const name = normalize(t.name.trim())
    const done = finished.filter(
      ({ w, name: n }) => w.templateId === t.id || ((!w.templateId || !ids.has(w.templateId)) && n === name),
    )
    if (!done.length) continue
    const lengths = done
      .map(({ ms }) => ms)
      .filter((ms) => ms >= SHORTEST && ms <= LONGEST)
      .slice(0, SESSIONS_AVERAGED)
    stats.set(t.id, {
      lastUsed: done[0].w.startedAt,
      average: lengths.length
        ? { ms: lengths.reduce((sum, ms) => sum + ms, 0) / lengths.length, sessions: lengths.length }
        : null,
    })
  }
  return stats
}

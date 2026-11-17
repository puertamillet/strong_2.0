import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ExercisePicker } from '../components/ExercisePicker'
import { ExerciseTags } from '../components/ExerciseTags'
import { Sheet } from '../components/Sheet'
import { db, type Exercise, type WorkoutSet } from '../db'
import { setFilmSets, setFilming, useFilming, weekDays, type FilmChoice } from '../lib/filming'
import { SET_TYPE_NAMES, setLabels } from '../lib/format'
import { haptic } from '../lib/haptics'
import { useExerciseMap } from '../lib/hooks'
import { useCloseSheet } from '../lib/sheets'
import { sortTemplates } from '../lib/templateOrder'
import { filmSetIndexes, lastPerformance, setKeys } from '../lib/workouts'

type Sets = Pick<WorkoutSet, 'type' | 'film'>[]

/** The sets an exercise that was never done starts with in a workout. */
const NEW_EXERCISE: Sets = [{ type: 'normal' }]

/** "del 9 al 15 de noviembre", "del 30 de noviembre al 6 de diciembre". */
function weekText(now: Date): string {
  const [monday, sunday] = weekDays(now)
  const long = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
  return monday.getMonth() === sunday.getMonth() ? `del ${monday.getDate()} al ${long(sunday)}` : `del ${long(monday)} al ${long(sunday)}`
}

/** "2 ejercicios para grabar", and how many sets when some exercise has more than one. */
function countText(chosen: FilmChoice[]): string {
  if (chosen.length === 0) return 'Ninguno elegido'
  const exercises = chosen.length === 1 ? '1 ejercicio para grabar' : `${chosen.length} ejercicios para grabar`
  const sets = chosen.reduce((n, c) => n + (c.sets?.length ?? 1), 0)
  return sets > chosen.length ? `${exercises} (${sets} series)` : exercises
}

/**
 * /filming — the exercises to film this week, as the trainer asks, and which of their sets. The
 * Monday reminder opens it, and so does «Grabar esta semana» in Entrenar. The exercises of the
 * templates come in their order, each under its template; any other one can be added. A chosen
 * exercise shows its sets, as in the workout, to choose which ones to film.
 */
export function FilmingRoute() {
  const close = useCloseSheet()
  const chosen = useFilming()
  const exercises = useExerciseMap()
  const templates = useLiveQuery(async () => sortTemplates(await db.templates.toArray()), [])
  const [picking, setPicking] = useState(false)
  const [now] = useState(() => new Date())

  const inTemplates = new Set(templates?.flatMap((t) => t.exercises.map((e) => e.exerciseId)))
  const others = chosen.map((c) => c.exerciseId).filter((id) => !inTemplates.has(id))
  // The sets of those in no template: the ones of the last time they were done.
  const othersKey = others.join(',')
  const otherSets = useLiveQuery(async () => {
    const ids = othersKey ? othersKey.split(',') : []
    return new Map(ids.length ? await Promise.all(ids.map(async (id) => [id, (await lastPerformance(id))?.sets ?? NEW_EXERCISE] as const)) : [])
  }, [othersKey])

  const row = (id: string, sets: Sets | undefined) => {
    const exercise = exercises?.get(id)
    if (!exercise) return null
    const choice = chosen.find((c) => c.exerciseId === id)
    return (
      <li key={id}>
        <button
          className={`row exercise-row ${choice ? 'selected' : ''}`}
          aria-pressed={Boolean(choice)}
          onClick={() => {
            haptic()
            setFilming(id, !choice)
          }}
        >
          <ExerciseName exercise={exercise} />
          {choice && <span className="check">✓</span>}
        </button>
        {choice && sets && sets.length > 0 && <FilmSets name={exercise.name} sets={sets} choice={choice} />}
      </li>
    )
  }

  return (
    <Sheet
      label="Grabar esta semana"
      title="Grabar esta semana"
      onDismiss={close}
      right={
        <button className="link strong" onClick={close}>
          Listo
        </button>
      }
    >
      <p className="muted small-text filming-intro">
        Semana {weekText(now)}. Elige los ejercicios que te toca grabar. De cada uno se marca la primera serie después
        del calentamiento (o la que marques en la plantilla); toca otras para cambiarla o para grabar varias.
      </p>
      <p className="filming-count" role="status">
        {countText(chosen)}
      </p>
      {exercises &&
        templates?.map((t) => (
          <section key={t.id}>
            <h3 className="group-title">{t.name}</h3>
            <ul className="list card">
              {t.exercises
                .filter((e, i) => t.exercises.findIndex((x) => x.exerciseId === e.exerciseId) === i)
                .map((e) => row(e.exerciseId, e.sets))}
            </ul>
          </section>
        ))}
      {exercises && others.length > 0 && (
        <section>
          <h3 className="group-title">Otros ejercicios</h3>
          <ul className="list card">{others.map((id) => row(id, otherSets?.get(id)))}</ul>
        </section>
      )}
      {templates?.length === 0 && <p className="empty">Aún no tienes plantillas: añade los ejercicios uno a uno.</p>}
      <button className="btn primary-outline full filming-add" onClick={() => setPicking(true)}>
        Añadir otro ejercicio
      </button>
      {picking && (
        <ExercisePicker
          title="Grabar esta semana"
          onClose={() => setPicking(false)}
          onPick={(ids) => {
            setPicking(false)
            for (const id of ids) setFilming(id, true)
          }}
        />
      )}
    </Sheet>
  )
}

/**
 * The sets of a chosen exercise, with their letters in the workout (C, T, B, 1…): those to film
 * are filled in. Tapping one films it too, or not any more; with none, the exercise is no longer
 * chosen.
 */
function FilmSets({ name, sets, choice }: { name: string; sets: Sets; choice: FilmChoice }) {
  const keys = setKeys(sets)
  const labels = setLabels(sets)
  const on = new Set(filmSetIndexes(sets, choice.sets))
  // While the sets haven't been chosen, the default ones are filmed.
  const current = choice.sets ?? [...on].map((i) => keys[i])
  return (
    <div className="film-sets" role="group" aria-label={`Series que grabar de ${name}`}>
      <span className="film-sets-label">Series:</span>
      {sets.map((s, i) => (
        <button
          key={i}
          className={`film-set type-${s.type} ${on.has(i) ? 'on' : ''}`}
          aria-pressed={on.has(i)}
          aria-label={
            s.type === 'warmup'
              ? `Calentamiento ${keys[i].slice(1)}`
              : `Serie ${keys[i]}${s.type === 'normal' ? '' : ` (${SET_TYPE_NAMES[s.type]})`}`
          }
          onClick={() => {
            haptic()
            setFilmSets(choice.exerciseId, on.has(i) ? current.filter((k) => k !== keys[i]) : [...current, keys[i]])
          }}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  )
}

function ExerciseName({ exercise }: { exercise: Exercise }) {
  return (
    <span className="exercise-row-text">
      <span className="exercise-row-title">
        {exercise.name} <ExerciseTags exercise={exercise} />
      </span>
    </span>
  )
}

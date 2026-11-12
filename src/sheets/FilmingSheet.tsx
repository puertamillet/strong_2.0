import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ExercisePicker } from '../components/ExercisePicker'
import { ExerciseTags } from '../components/ExerciseTags'
import { Sheet } from '../components/Sheet'
import { db, type Exercise } from '../db'
import { setFilming, useFilming, weekDays } from '../lib/filming'
import { haptic } from '../lib/haptics'
import { useExerciseMap } from '../lib/hooks'
import { useCloseSheet } from '../lib/sheets'
import { sortTemplates } from '../lib/templateOrder'

/** "del 9 al 15 de noviembre", "del 30 de noviembre al 6 de diciembre". */
function weekText(now: Date): string {
  const [monday, sunday] = weekDays(now)
  const long = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
  return monday.getMonth() === sunday.getMonth() ? `del ${monday.getDate()} al ${long(sunday)}` : `del ${long(monday)} al ${long(sunday)}`
}

/**
 * /filming — the exercises to film this week, as the trainer asks. The Monday reminder opens it,
 * and so does «Grabar esta semana» in Entrenar. The exercises of the templates come in their
 * order, each under its template; any other one can be added.
 */
export function FilmingRoute() {
  const close = useCloseSheet()
  const chosen = useFilming()
  const exercises = useExerciseMap()
  const templates = useLiveQuery(async () => sortTemplates(await db.templates.toArray()), [])
  const [picking, setPicking] = useState(false)
  const [now] = useState(() => new Date())

  const inTemplates = new Set(templates?.flatMap((t) => t.exercises.map((e) => e.exerciseId)))
  const others = chosen.filter((id) => !inTemplates.has(id))

  const row = (id: string) => {
    const exercise = exercises?.get(id)
    if (!exercise) return null
    const on = chosen.includes(id)
    return (
      <li key={id}>
        <button
          className={`row exercise-row ${on ? 'selected' : ''}`}
          aria-pressed={on}
          onClick={() => {
            haptic()
            setFilming(id, !on)
          }}
        >
          <ExerciseName exercise={exercise} />
          {on && <span className="check">✓</span>}
        </button>
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
        Semana {weekText(now)}. Elige los ejercicios que te toca grabar: en el entreno verás marcada su primera serie (o
        la que marques en la plantilla, en el menú de la serie).
      </p>
      <p className="filming-count" role="status">
        {chosen.length === 0
          ? 'Ninguno elegido'
          : chosen.length === 1
            ? '1 ejercicio para grabar'
            : `${chosen.length} ejercicios para grabar`}
      </p>
      {exercises &&
        templates?.map((t) => (
          <section key={t.id}>
            <h3 className="group-title">{t.name}</h3>
            <ul className="list card">{[...new Set(t.exercises.map((e) => e.exerciseId))].map(row)}</ul>
          </section>
        ))}
      {exercises && others.length > 0 && (
        <section>
          <h3 className="group-title">Otros ejercicios</h3>
          <ul className="list card">{others.map(row)}</ul>
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

function ExerciseName({ exercise }: { exercise: Exercise }) {
  return (
    <span className="exercise-row-text">
      <span className="exercise-row-title">
        {exercise.name} <ExerciseTags exercise={exercise} />
      </span>
    </span>
  )
}

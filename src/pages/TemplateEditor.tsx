import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ExercisePicker } from '../components/ExercisePicker'
import { db, DEFAULT_REST_SECONDS, newId, type SetType, type Template } from '../db'
import { fmtClock, SET_TYPE_NAMES, setLabels } from '../lib/format'
import { lastPerformance } from '../lib/workouts'

const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300]

export function TemplateEditor() {
  const { id = 'new' } = useParams()
  // Remount when the id changes so the draft state starts fresh.
  return <Editor key={id} id={id} />
}

function Editor({ id }: { id: string }) {
  const navigate = useNavigate()
  const isNew = id === 'new'
  const [draft, setDraft] = useState<Template | null>(() =>
    isNew ? { id: newId(), name: '', exercises: [], updatedAt: Date.now() } : null,
  )
  const [picking, setPicking] = useState(false)
  const exercises = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e] as const)),
    [],
  )

  useEffect(() => {
    if (!isNew) void db.templates.get(id).then((t) => setDraft(t ?? null))
  }, [id, isNew])

  if (!draft || !exercises) return <div className="page" />

  const update = (fn: (t: Template) => void) =>
    setDraft((d) => {
      if (!d) return d
      const copy = structuredClone(d)
      fn(copy)
      return copy
    })

  async function save() {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      alert('Ponle un nombre a la plantilla.')
      return
    }
    await db.templates.put({ ...draft, name, updatedAt: Date.now() })
    navigate('/', { replace: true })
  }

  async function remove() {
    if (!draft || !confirm(`¿Eliminar la plantilla «${draft.name}»?`)) return
    await db.templates.delete(draft.id)
    navigate('/', { replace: true })
  }

  async function addExercises(ids: string[]) {
    setPicking(false)
    const prev = await Promise.all(ids.map((eid) => lastPerformance(eid)))
    update((t) => {
      ids.forEach((exerciseId, i) => {
        const p = prev[i]
        t.exercises.push({
          exerciseId,
          restSeconds: p?.restSeconds ?? exercises?.get(exerciseId)?.defaultRestSeconds ?? DEFAULT_REST_SECONDS,
          sets: (p?.sets.length ? p.sets : [{ type: 'normal' as SetType }]).map((s) => ({
            type: s.type,
            weight: null,
            reps: null,
          })),
        })
      })
    })
  }

  return (
    <div className="page">
      <header className="page-header sticky">
        <button className="link" onClick={() => navigate(-1)}>
          Cancelar
        </button>
        <strong>{isNew ? 'Nueva plantilla' : 'Editar plantilla'}</strong>
        <button className="btn small primary" onClick={save}>
          Guardar
        </button>
      </header>

      <input
        className="title-input"
        placeholder="Nombre de la plantilla"
        value={draft.name}
        onChange={(e) => {
          const v = e.target.value
          update((t) => {
            t.name = v
          })
        }}
      />

      {draft.exercises.map((te, ei) => {
        const labels = setLabels(te.sets)
        return (
          <section key={`${te.exerciseId}-${ei}`} className="card exercise-card">
            <div className="exercise-head">
              <h3>{exercises.get(te.exerciseId)?.name ?? 'Ejercicio eliminado'}</h3>
              <label className="select-chip">
                ⋯
                <select
                  value=""
                  aria-label="Opciones del ejercicio"
                  onChange={(e) => {
                    const a = e.target.value
                    update((t) => {
                      if (a === 'remove') t.exercises.splice(ei, 1)
                      if (a === 'up' || a === 'down') {
                        const [item] = t.exercises.splice(ei, 1)
                        t.exercises.splice(ei + (a === 'up' ? -1 : 1), 0, item)
                      }
                    })
                  }}
                >
                  <option value="" disabled>
                    Opciones
                  </option>
                  {ei > 0 && <option value="up">Mover arriba</option>}
                  {ei < draft.exercises.length - 1 && <option value="down">Mover abajo</option>}
                  <option value="remove">Quitar ejercicio</option>
                </select>
              </label>
            </div>
            <div className="exercise-meta">
              <label className="select-chip">
                ⏱ {te.restSeconds ? fmtClock(te.restSeconds) : 'Sin descanso'}
                <select
                  value={te.restSeconds}
                  aria-label="Tiempo de descanso"
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    update((t) => {
                      t.exercises[ei].restSeconds = v
                    })
                  }}
                >
                  {[...new Set([...REST_OPTIONS, te.restSeconds])]
                    .sort((a, b) => a - b)
                    .map((s) => (
                      <option key={s} value={s}>
                        {s ? fmtClock(s) : 'Sin descanso'}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="chips">
              {te.sets.map((s, si) => {
                return (
                  <label key={si} className={`set-type type-${s.type}`}>
                    {labels[si]}
                    <select
                      value={s.type}
                      aria-label="Tipo de serie"
                      onChange={(e) => {
                        const v = e.target.value
                        update((t) => {
                          if (v === 'delete') t.exercises[ei].sets.splice(si, 1)
                          else t.exercises[ei].sets[si].type = v as SetType
                        })
                      }}
                    >
                      {(Object.keys(SET_TYPE_NAMES) as SetType[]).map((t) => (
                        <option key={t} value={t}>
                          {SET_TYPE_NAMES[t]}
                        </option>
                      ))}
                      <option value="delete">Eliminar serie</option>
                    </select>
                  </label>
                )
              })}
              <button
                className="set-type add"
                aria-label="Añadir serie"
                onClick={() =>
                  update((t) => {
                    t.exercises[ei].sets.push({ type: 'normal', weight: null, reps: null })
                  })
                }
              >
                ＋
              </button>
            </div>
          </section>
        )
      })}

      <div className="stack">
        <button className="btn primary-outline" onClick={() => setPicking(true)}>
          Añadir ejercicios
        </button>
        {!isNew && (
          <button className="btn danger" onClick={remove}>
            Eliminar plantilla
          </button>
        )}
      </div>

      {picking && <ExercisePicker onClose={() => setPicking(false)} onPick={addExercises} />}
    </div>
  )
}

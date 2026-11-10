import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, type Template } from '../db'
import { fmtShortDate } from '../lib/format'
import { getActiveWorkout, startWorkout } from '../lib/workouts'

export function StartPage() {
  const navigate = useNavigate()
  const active = useLiveQuery(() => getActiveWorkout().then((w) => w ?? null), [])
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray(), [])
  const exerciseNames = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e.name] as const)),
    [],
  )
  const lastUsed = useLiveQuery(async () => {
    const map = new Map<string, number>()
    for (const t of await db.templates.toArray()) {
      const last = await db.workouts.where('templateId').equals(t.id).reverse().sortBy('startedAt')
      if (last[0]) map.set(t.id, last[0].startedAt)
    }
    return map
  }, [])

  async function start(template?: Template) {
    if (active && !confirm(`Ya tienes un entreno en curso («${active.name}»). ¿Continuarlo?`)) return
    const id = await startWorkout(template)
    navigate(`/workout/${id}`)
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Entrenar</h1>
      </header>

      {active ? (
        <button className="card active-card" onClick={() => navigate(`/workout/${active.id}`)}>
          <span className="muted">Entreno en curso</span>
          <strong>{active.name}</strong>
          <span className="link">Continuar ›</span>
        </button>
      ) : (
        <button className="btn primary full" onClick={() => start()}>
          Empezar entreno vacío
        </button>
      )}

      <div className="section-head">
        <h2>Plantillas</h2>
        <button className="link strong" onClick={() => navigate('/templates/new')}>
          ＋ Nueva
        </button>
      </div>

      {templates?.length === 0 && (
        <p className="empty">
          Aún no tienes plantillas. Crea una, o guarda un entreno como plantilla al terminarlo.
        </p>
      )}

      <div className="template-grid">
        {templates?.map((t) => (
          <article key={t.id} className="card template-card">
            <button className="template-body" onClick={() => navigate(`/templates/${t.id}`)}>
              <strong>{t.name}</strong>
              <span className="muted small-text">
                {t.exercises
                  .map((e) => `${e.sets.length} × ${exerciseNames?.get(e.exerciseId) ?? '?'}`)
                  .join(', ')}
              </span>
              {lastUsed?.get(t.id) && (
                <span className="muted small-text">Último: {fmtShortDate(lastUsed.get(t.id)!)}</span>
              )}
            </button>
            <button className="btn small primary" onClick={() => start(t)}>
              Empezar
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}

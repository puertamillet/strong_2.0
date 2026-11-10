import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db, type Template } from '../db'
import { fmtShortDate, normalize } from '../lib/format'
import { getActiveWorkout, startWorkout } from '../lib/workouts'

export function StartPage() {
  const navigate = useNavigate()
  const active = useLiveQuery(() => getActiveWorkout().then((w) => w ?? null), [])
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray(), [])
  const workoutCount = useLiveQuery(() => db.workouts.count(), [])
  const exerciseNames = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, e.name] as const)),
    [],
  )
  // Last time each template's routine was done: by template link, or by name (imported workouts).
  const lastUsed = useLiveQuery(async () => {
    const byTemplate = new Map<string, number>()
    const byName = new Map<string, number>()
    await db.workouts.orderBy('startedAt').each((w) => {
      if (w.endedAt === null) return
      if (w.templateId) byTemplate.set(w.templateId, w.startedAt)
      byName.set(normalize(w.name.trim()), w.startedAt)
    })
    const map = new Map<string, number>()
    for (const t of await db.templates.toArray()) {
      const last = byTemplate.get(t.id) ?? byName.get(normalize(t.name.trim()))
      if (last) map.set(t.id, last)
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

      {workoutCount === 0 && (
        <button className="card hint-card" onClick={() => navigate('/settings')}>
          <strong>¿Vienes de Strong?</strong>
          <span className="muted small-text">Importa tu historial y tus rutinas desde el CSV que exporta Strong.</span>
          <span className="link">Importar ›</span>
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

import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { choose } from '../lib/dialog'
import { ReorderList } from '../components/ReorderList'
import { Icon } from '../components/icons'
import { CloseButton } from '../components/Sheet'
import { db, type Template } from '../db'
import { exerciseLabel } from '../lib/exercises'
import { useFilming } from '../lib/filming'
import { fmtDuration, fmtShortDate } from '../lib/format'
import { restTimer } from '../lib/restTimer'
import { SHOW_SET_ONCE } from '../lib/setOnce'
import { useOpenSheet } from '../lib/sheets'
import { saveTemplateOrder, sortTemplates } from '../lib/templateOrder'
import { templateStats, type TemplateStats } from '../lib/templateStats'
import { discardWorkout, getActiveWorkout, startWorkout } from '../lib/workouts'

export function StartPage() {
  const navigate = useNavigate()
  const openSheet = useOpenSheet()
  const active = useLiveQuery(() => getActiveWorkout().then((w) => w ?? null), [])
  const templates = useLiveQuery(async () => sortTemplates(await db.templates.toArray()), [])
  const workoutCount = useLiveQuery(() => db.workouts.count(), [])
  const exerciseNames = useLiveQuery(
    async () => new Map((await db.exercises.toArray()).map((e) => [e.id, exerciseLabel(e)] as const)),
    [],
  )
  const [preview, setPreview] = useState<Template | null>(null)
  const filming = useFilming()
  // When each template was last done and how long it takes.
  const stats = useLiveQuery(async () => templateStats(await db.templates.toArray(), await db.workouts.toArray()), [])

  async function start(template?: Template) {
    setPreview(null)
    if (active) {
      const choice = await choose(
        'Ya tienes un entreno en curso',
        [
          { label: 'Continuar el entreno', value: 'resume', style: 'primary' },
          { label: 'Descartarlo y empezar otro', value: 'discard', style: 'danger' },
          { label: 'Cancelar', value: null },
        ],
        `«${active.name}» sigue abierto.`,
      )
      if (choice === 'resume') {
        openSheet(`/workout/${active.id}`)
        return
      }
      if (choice !== 'discard') return
      await discardWorkout(active.id)
      restTimer.stop()
    }
    const id = await startWorkout(template)
    openSheet(`/workout/${id}`)
  }

  const names = (t: Template) => t.exercises.map((e) => exerciseNames?.get(e.exerciseId) ?? '?').join(', ')

  return (
    <div className="page">
      <header className="page-header">
        <h1>Entrenar</h1>
      </header>

      <button className="btn primary full" onClick={() => void start()}>
        Empezar entreno vacío
      </button>

      {/* The exercises to film this week (the Monday reminder opens the same page). */}
      <button className="card filming-card" onClick={() => openSheet('/filming')}>
        <Icon name="camera" size={22} />
        <span className="filming-card-text">
          <strong>Grabar esta semana</strong>
          <span className="muted small-text">
            {filming.length
              ? filming.map((id) => exerciseNames?.get(id) ?? '?').join(', ')
              : 'Elige qué ejercicios te toca grabar'}
          </span>
        </span>
        <Icon name="chevronRight" size={18} />
      </button>

      {SHOW_SET_ONCE && workoutCount === 0 && (
        <button className="card hint-card" onClick={() => navigate('/settings')}>
          <strong>¿Vienes de Strong?</strong>
          <span className="muted small-text">Importa tu historial y tus rutinas desde el CSV que exporta Strong.</span>
          <span className="link">Importar ›</span>
        </button>
      )}

      <div className="section-head">
        <h2>Plantillas</h2>
        <button className="link strong" onClick={() => openSheet('/templates/new')}>
          ＋ Nueva
        </button>
      </div>

      {templates?.length === 0 && (
        <p className="empty">Aún no tienes plantillas. Crea una, o guarda un entreno como plantilla al terminarlo.</p>
      )}

      {/* Hold a template and drag it to change the order. */}
      <ReorderList className="template-grid" items={templates ?? []} keyOf={(t) => t.id} onReorder={(ids) => void saveTemplateOrder(ids)}>
        {(t) => (
          <button className="card template-card" onClick={() => setPreview(t)}>
            <strong>{t.name}</strong>
            <span className="muted small-text template-exercises">{names(t)}</span>
            {stats?.get(t.id) && <span className="muted small-text">{statsText(stats.get(t.id)!)}</span>}
          </button>
        )}
      </ReorderList>

      {preview && (
        <TemplatePreview
          template={preview}
          names={exerciseNames}
          stats={stats?.get(preview.id)}
          onClose={() => setPreview(null)}
          onEdit={() => {
            setPreview(null)
            openSheet(`/templates/${preview.id}`)
          }}
          onStart={() => void start(preview)}
        />
      )}
    </div>
  )
}

/** "Último: 12 nov · Duración media: 1 h 52 min", and how many sessions that is of with `count`. */
function statsText({ lastUsed, average }: TemplateStats, count = false): string {
  const last = `Último: ${fmtShortDate(lastUsed)}`
  if (!average) return last
  const of = average.sessions === 1 ? '1 sesión' : `últimas ${average.sessions} sesiones`
  return `${last} · Duración media: ${fmtDuration(average.ms)}${count ? ` (${of})` : ''}`
}

interface PreviewProps {
  template: Template
  names?: Map<string, string>
  stats?: TemplateStats
  onClose: () => void
  onEdit: () => void
  onStart: () => void
}

/** A template at a glance, like Strong: its exercises and working sets, Editar and Empezar. */
function TemplatePreview({ template, names, stats, onClose, onEdit, onStart }: PreviewProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog template-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="preview-head">
          <CloseButton onClick={onClose} />
          <h2 id="preview-title">{template.name}</h2>
          <button className="link strong" onClick={onEdit}>
            Editar
          </button>
        </div>
        {stats && <p className="muted small-text">{statsText(stats, true)}</p>}
        <ul className="preview-list">
          {template.exercises.map((e, i) => {
            const working = e.sets.filter((s) => s.type !== 'warmup').length
            return (
              <li key={i}>
                <span className="preview-sets">{working} ×</span>
                <span>{names?.get(e.exerciseId) ?? 'Ejercicio eliminado'}</span>
              </li>
            )
          })}
        </ul>
        {template.exercises.length === 0 && <p className="muted small-text">Esta plantilla no tiene ejercicios.</p>}
        <button className="btn primary full" onClick={onStart}>
          Empezar entreno
        </button>
      </div>
    </div>
  )
}

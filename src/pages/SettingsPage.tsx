import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db'
import {
  createBackup,
  deleteAllData,
  exportStrongCsv,
  fileStamp,
  getLastBackup,
  importStrongCsv,
  markBackupDone,
  restoreBackup,
  saveFile,
  type ImportSummary,
} from '../lib/backup'
import { fmtDate } from '../lib/format'
import { seedIfEmpty } from '../seed'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'ok'; text: string } | { kind: 'error'; text: string }

export function SettingsPage() {
  const navigate = useNavigate()
  const counts = useLiveQuery(async () => {
    const [workouts, exercises, templates] = await Promise.all([
      db.workouts.count(),
      db.exercises.count(),
      db.templates.count(),
    ])
    return { workouts, exercises, templates }
  }, [])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [lastBackup, setLastBackup] = useState(getLastBackup)
  const [openedAt] = useState(Date.now)
  const [createTemplates, setCreateTemplates] = useState(true)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const csvInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const busy = status.kind === 'busy'

  async function onImportCsv(file: File) {
    setSummary(null)
    setStatus({ kind: 'busy', text: 'Importando…' })
    try {
      const result = await importStrongCsv(await file.text(), { createTemplates })
      setSummary(result)
      setStatus({ kind: 'ok', text: 'Importación completada.' })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function onBackup() {
    setStatus({ kind: 'busy', text: 'Preparando la copia…' })
    try {
      const data = await createBackup()
      const saved = await saveFile(`strong2-copia-${fileStamp()}.json`, JSON.stringify(data), 'application/json')
      if (saved) {
        markBackupDone()
        setLastBackup(getLastBackup())
      }
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function onExportCsv() {
    setStatus({ kind: 'busy', text: 'Generando CSV…' })
    try {
      await saveFile(`strong2-entrenos-${fileStamp()}.csv`, await exportStrongCsv(), 'text/csv')
      setStatus({ kind: 'idle' })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function onRestore(file: File) {
    if (!confirm('Restaurar la copia reemplazará TODOS los datos actuales. ¿Continuar?')) return
    setSummary(null)
    setStatus({ kind: 'busy', text: 'Restaurando…' })
    try {
      const { workouts } = await restoreBackup(await file.text())
      setStatus({ kind: 'ok', text: `Copia restaurada: ${workouts} entrenos.` })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function onDeleteAll() {
    if (!confirm('¿Borrar todos los entrenos, plantillas y ejercicios de este dispositivo?')) return
    if (!confirm('Esta acción no se puede deshacer. ¿Seguro?')) return
    await deleteAllData()
    await seedIfEmpty()
    setSummary(null)
    setStatus({ kind: 'ok', text: 'Datos borrados.' })
  }

  const daysSinceBackup = lastBackup ? Math.floor((openedAt - lastBackup) / 86_400_000) : null

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ajustes</h1>
      </header>

      <section className="card settings-section">
        <h2>Importar desde Strong</h2>
        <p className="muted small-text">
          En Strong: Ajustes → Exportar datos. Guarda el CSV en Archivos y selecciónalo aquí. Puedes repetir la
          importación cuando quieras: los entrenos que ya estén no se duplican.
        </p>
        <label className="toggle">
          <input type="checkbox" checked={createTemplates} onChange={(e) => setCreateTemplates(e.target.checked)} />
          Crear plantillas con mis rutinas de los últimos 3 meses
        </label>
        <button className="btn primary full" disabled={busy} onClick={() => csvInput.current?.click()}>
          Elegir CSV de Strong
        </button>
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv,text/comma-separated-values"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onImportCsv(f)
          }}
        />
        {summary && (
          <div className="import-summary">
            <p>
              <strong>{summary.added}</strong> entrenos importados
              {summary.skipped > 0 && <> ({summary.skipped} ya estaban)</>}, <strong>{summary.newExercises}</strong>{' '}
              ejercicios nuevos.
            </p>
            {summary.templates.length > 0 && (
              <p>
                Plantillas creadas: <strong>{summary.templates.join(', ')}</strong>.
              </p>
            )}
            <button className="link strong" onClick={() => navigate('/history')}>
              Ver historial ›
            </button>
          </div>
        )}
      </section>

      <section className="card settings-section">
        <h2>Copia de seguridad</h2>
        <p className="muted small-text">
          Tus datos solo están en este iPhone. Haz una copia de vez en cuando y guárdala en iCloud Drive.{' '}
          {lastBackup ? (
            <>
              Última copia: {fmtDate(lastBackup)}
              {daysSinceBackup !== null && daysSinceBackup > 30 && <strong> (hace más de un mes)</strong>}.
            </>
          ) : (
            <strong>Aún no has hecho ninguna copia.</strong>
          )}
        </p>
        <button className="btn primary-outline full" disabled={busy} onClick={onBackup}>
          Guardar copia completa (JSON)
        </button>
        <button className="btn full" disabled={busy} onClick={() => backupInput.current?.click()}>
          Restaurar una copia…
        </button>
        <input
          ref={backupInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onRestore(f)
          }}
        />
        <button className="btn full" disabled={busy} onClick={onExportCsv}>
          Exportar entrenos a CSV (formato Strong)
        </button>
      </section>

      {status.kind !== 'idle' && (
        <p className={`status status-${status.kind}`} role="status">
          {status.text}
        </p>
      )}

      <section className="card settings-section">
        <h2>Datos</h2>
        <p className="muted small-text">
          {counts?.workouts ?? 0} entrenos · {counts?.templates ?? 0} plantillas · {counts?.exercises ?? 0} ejercicios
          <br />
          {persisted === true && 'Almacenamiento persistente activado: Safari no borrará los datos.'}
          {persisted === false &&
            'Almacenamiento no persistente: instala la app en la pantalla de inicio y haz copias de seguridad.'}
        </p>
        <button className="btn danger full" disabled={busy} onClick={onDeleteAll}>
          Borrar todos los datos
        </button>
      </section>
    </div>
  )
}

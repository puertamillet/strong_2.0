import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { confirmDialog, notify } from '../lib/dialog'
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
import { setBodyFigure, useBodyFigure } from '../lib/bodyFigure'
import { exerciseLabel } from '../lib/exercises'
import { fmtDate, fmtDateTime } from '../lib/format'
import { setKeepAwake, useKeepAwakeSetting, wakeLockSupported } from '../lib/keepAwake'
import { disablePush, enablePush, scheduleRestPush, usePushStatus, type PushStatus } from '../lib/push'
import { useRestTimer } from '../lib/restTimer'
import { setSoundInSilentMode, signalRestOver, silentModeSoundSupported, useSoundInSilentMode } from '../lib/sound'
import { applyTemplateImport, exportTemplatesCsv, prepareTemplateImport } from '../lib/templatesCsv'
import { seedIfEmpty } from '../seed'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'ok'; text: string } | { kind: 'error'; text: string }

const PUSH_HELP: Record<PushStatus, string> = {
  on: 'Al acabar el descanso te llega una notificación aunque el iPhone esté bloqueado o estés en otra app: suena con el tono de las notificaciones y vibra (en silencio, solo vibra). Con la app abierta también llega, además del ping.',
  off: 'Al acabar el descanso te llega una notificación aunque el iPhone esté bloqueado o estés en otra app: suena con el tono de las notificaciones y vibra (en silencio, solo vibra).',
  'no-server':
    'Esta versión no tiene servidor de avisos. Los pasos para conectarlo (Cloudflare, gratis) están en el README del repositorio.',
  'not-installed':
    'Para recibir avisos, añade la app a la pantalla de inicio desde Safari (iOS 16.4 o posterior) y ábrela desde allí.',
  denied: 'Las notificaciones de la app están desactivadas: actívalas en Ajustes del iPhone → Notificaciones → Strong 2.0.',
}

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
  const keepAwake = useKeepAwakeSetting()
  const soundInSilentMode = useSoundInSilentMode()
  const push = usePushStatus()
  const rest = useRestTimer()
  const bodyFigure = useBodyFigure()
  const [pushBusy, setPushBusy] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [lastBackup, setLastBackup] = useState(getLastBackup)
  const [openedAt] = useState(Date.now)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const csvInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const templatesInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const busy = status.kind === 'busy'

  async function onImportCsv(file: File) {
    setSummary(null)
    setStatus({ kind: 'busy', text: 'Importando…' })
    try {
      const result = await importStrongCsv(await file.text())
      setSummary(result)
      setStatus({ kind: 'ok', text: 'Importación completada.' })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function onImportTemplates(file: File) {
    setSummary(null)
    try {
      const plan = await prepareTemplateImport(await file.text())
      const names = plan.templates.map((t) => `«${t.name}»`).join(', ')
      const details = [
        names + '.',
        plan.replaced.length ? `Sustituyen a las que ya tienes con el mismo nombre: ${plan.replaced.join(', ')}.` : '',
        plan.newExercises.length
          ? `Ejercicios nuevos: ${plan.newExercises.map(exerciseLabel).join(', ')}.`
          : '',
      ]
      const n = plan.templates.length
      const ok = await confirmDialog({
        title: `¿Importar ${n} ${n === 1 ? 'plantilla' : 'plantillas'}?`,
        message: details.filter(Boolean).join(' '),
        confirm: 'Importar',
      })
      if (!ok) return
      await applyTemplateImport(plan)
      await notify('Plantillas importadas', `Ya están en Entrenar: ${names}.`)
    } catch (e) {
      await notify('No se ha podido importar', (e as Error).message)
    }
  }

  async function onExportTemplates() {
    setStatus({ kind: 'busy', text: 'Generando CSV…' })
    try {
      await saveFile(`strong2-plantillas-${fileStamp()}.csv`, await exportTemplatesCsv(), 'text/csv')
      setStatus({ kind: 'idle' })
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
    const ok = await confirmDialog({
      title: '¿Restaurar la copia?',
      message: 'Reemplazará todos los datos de este dispositivo por los de la copia.',
      confirm: 'Restaurar',
      danger: true,
    })
    if (!ok) return
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
    const first = await confirmDialog({
      title: '¿Borrar todos los datos?',
      message: 'Se borrarán los entrenos, las plantillas y los ejercicios de este dispositivo.',
      confirm: 'Borrar todo',
      danger: true,
    })
    if (!first) return
    const sure = await confirmDialog({
      title: 'No se puede deshacer',
      message: 'Si no tienes una copia de seguridad, perderás tu historial. ¿Seguro?',
      confirm: 'Sí, borrar todo',
      danger: true,
    })
    if (!sure) return
    await deleteAllData()
    await seedIfEmpty()
    setSummary(null)
    setStatus({ kind: 'ok', text: 'Datos borrados.' })
  }

  const daysSinceBackup = lastBackup ? Math.floor((openedAt - lastBackup) / 86_400_000) : null

  async function togglePush(on: boolean) {
    setPushBusy(true)
    try {
      if (on) await enablePush()
      else await disablePush()
    } catch (e) {
      await notify('No se pudieron activar los avisos', e instanceof Error ? e.message : String(e))
    } finally {
      setPushBusy(false)
    }
  }

  async function testPush() {
    // One rest per phone on the server: a test now would replace the real one.
    if (rest) {
      await notify('Hay un descanso en marcha', 'Te llegará el aviso cuando acabe: bloquea el iPhone y espera.')
      return
    }
    scheduleRestPush(Date.now() + 10_000)
    await notify('Bloquea el iPhone', 'En 10 segundos te llegará el aviso, como al acabar un descanso.')
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ajustes</h1>
      </header>

      <section className="card settings-section">
        <h2>Entreno</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={wakeLockSupported && keepAwake}
            disabled={!wakeLockSupported}
            onChange={(e) => setKeepAwake(e.target.checked)}
          />
          Mantener la pantalla encendida durante el entreno
        </label>
        {!wakeLockSupported && (
          <p className="muted small-text">Este navegador no permite mantener la pantalla encendida.</p>
        )}
        <p className="muted small-text">
          Al acabar el descanso suena un ping si la app está en pantalla. Con el iPhone bloqueado o en otra app, iOS
          congela las apps web y no puede sonar: para eso está el aviso de abajo.
        </p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={silentModeSoundSupported && soundInSilentMode}
            disabled={!silentModeSoundSupported}
            onChange={(e) => setSoundInSilentMode(e.target.checked)}
          />
          Sonar aunque el iPhone esté en silencio
        </label>
        <p className="muted small-text">
          {silentModeSoundSupported
            ? 'Para sonar en silencio, iOS trata el ping como música: si estás escuchando música o un podcast, se pausa al sonar.'
            : 'Este navegador no permite sonar en modo silencio: si no oyes el ping, quita el modo silencio.'}
        </p>
        <button className="btn full" onClick={signalRestOver}>
          Probar el sonido
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={push === 'on'}
            disabled={pushBusy || push === 'no-server' || push === 'not-installed'}
            onChange={(e) => void togglePush(e.target.checked)}
          />
          Avisar con el iPhone bloqueado
        </label>
        <p className="muted small-text">{PUSH_HELP[push]}</p>
        {push === 'on' && (
          <button className="btn full" onClick={() => void testPush()}>
            Probar el aviso
          </button>
        )}
      </section>

      <section className="card settings-section">
        <h2>Ejercicios</h2>
        <span className="field-label" id="figure-label">
          Figura en la ficha del ejercicio
        </span>
        <div className="segmented" role="group" aria-labelledby="figure-label">
          {(
            [
              ['male', 'Hombre'],
              ['female', 'Mujer'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={bodyFigure === value} onClick={() => setBodyFigure(value)}>
              {label}
            </button>
          ))}
        </div>
        <p className="muted small-text">La ficha de cada ejercicio muestra en ella los músculos que trabaja.</p>
      </section>

      <section className="card settings-section">
        <h2>Importar desde Strong</h2>
        <p className="muted small-text">
          En Strong: Ajustes → Exportar datos. Guarda el CSV en Archivos y selecciónalo aquí. Puedes repetir la
          importación cuando quieras: los entrenos que ya estén no se duplican.
        </p>
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
            <button className="link strong" onClick={() => navigate('/history')}>
              Ver historial ›
            </button>
          </div>
        )}
      </section>

      <section className="card settings-section">
        <h2>Plantillas</h2>
        <p className="muted small-text">
          Importa plantillas desde un CSV con una fila por serie (peso, repeticiones, rango, descansos y notas), o
          exporta las tuyas para editarlas en Numbers o Excel. Las plantillas importadas sustituyen a las que se
          llamen igual.
        </p>
        <button className="btn primary full" disabled={busy} onClick={() => templatesInput.current?.click()}>
          Importar plantillas (CSV)
        </button>
        <input
          ref={templatesInput}
          type="file"
          accept=".csv,text/csv,text/comma-separated-values"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onImportTemplates(f)
          }}
        />
        <button className="btn full" disabled={busy || !counts?.templates} onClick={onExportTemplates}>
          Exportar plantillas (CSV)
        </button>
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

      <p className="app-version muted small-text">
        Versión {__APP_VERSION__} · {fmtDateTime(Date.parse(__BUILD_TIME__))}
      </p>
    </div>
  )
}

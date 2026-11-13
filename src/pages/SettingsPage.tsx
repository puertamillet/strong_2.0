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
import { isNativeApp } from '../lib/native'
import {
  disablePush,
  disableReminder,
  enablePush,
  enableReminder,
  nextReminderAt,
  scheduleRestPush,
  setReminderTime,
  testReminder,
  usePushStatus,
  useReminder,
  useReminderStatus,
  type PushStatus,
} from '../lib/push'
import { useRestTimer } from '../lib/restTimer'
import { SHOW_SET_ONCE } from '../lib/setOnce'
import { signalRestOver } from '../lib/sound'
import { applyTemplateImport, exportTemplatesCsv, prepareTemplateImport } from '../lib/templatesCsv'
import { seedIfEmpty } from '../seed'

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'ok'; text: string } | { kind: 'error'; text: string }

const WEB_PUSH_HELP: Record<PushStatus, string> = {
  on: 'Al acabar el descanso te llega una notificación aunque el iPhone esté bloqueado o estés en otra app: suena con el tono de las notificaciones y vibra (en silencio, solo vibra). Con la app abierta también llega, además del ping, y se quita sola a los pocos segundos; las que lleguen con la app cerrada se quitan al volver a ella. Si no vibra: Ajustes del iPhone → Notificaciones → Strong 2.0, con los sonidos activados, y Sonidos y vibraciones, con la vibración activada.',
  off: 'Al acabar el descanso te llega una notificación aunque el iPhone esté bloqueado o estés en otra app: suena con el tono de las notificaciones y vibra (en silencio, solo vibra). Una app web no puede hacer vibrar el iPhone por sí misma: la vibración llega con la notificación.',
  'no-server':
    'Esta versión no tiene servidor de avisos. Los pasos para conectarlo (Cloudflare, gratis) están en el README del repositorio.',
  'not-installed':
    'Para recibir avisos, añade la app a la pantalla de inicio desde Safari (iOS 16.4 o posterior) y ábrela desde allí.',
  denied: 'Las notificaciones de la app están desactivadas: actívalas en Ajustes del iPhone → Notificaciones → Strong 2.0.',
}

/** The iPhone app's notifications are its own (lib/localNotifications): no server, nothing to install. */
const NATIVE_PUSH_HELP: Record<PushStatus, string> = {
  ...WEB_PUSH_HELP,
  on: 'Al acabar el descanso suena el ping y vibra aunque el iPhone esté bloqueado, en silencio o estés en otra app, por encima de la música o el podcast y sin pararlos, y la pantalla de bloqueo dice «Descanso terminado» con la siguiente serie. Si tienes quitadas las actividades en directo, en su lugar te llega un aviso con ella, que se quita solo al volver a la app. Con la app en pantalla solo suena el ping. Si iOS cerró la app durante el descanso (lo hace a veces cuando necesita memoria), avisa la notificación, que en silencio solo vibra.',
  off: 'Al acabar el descanso suena el ping y vibra aunque el iPhone esté bloqueado, en silencio o estés en otra app, por encima de la música o el podcast y sin pararlos, y la pantalla de bloqueo dice «Descanso terminado» con la siguiente serie.',
}

const PUSH_HELP = isNativeApp ? NATIVE_PUSH_HELP : WEB_PUSH_HELP

const LIVE_ACTIVITY_HELP =
  'Durante el descanso, la cuenta atrás y la siguiente serie se ven en la pantalla de bloqueo y en la Dynamic Island. Al acabar, se queda «Descanso terminado» con la siguiente serie hasta el próximo descanso o el final del entreno. Si no sale: Ajustes del iPhone → Strong 2.0 → Actividades en directo.'

const PING_HELP = isNativeApp
  ? 'Al acabar el descanso suena un ping, un doble «ding», y vibra. Suena también con el iPhone en silencio, con el volumen de la música, y la música o el podcast solo bajan un momento de volumen, sin pararse. Con el iPhone bloqueado o en otra app suena igual si está activado el aviso de abajo.'
  : 'Al acabar el descanso suena un ping si la app está en pantalla, por encima de la música o el podcast y sin pararlos. Con el iPhone en silencio el ping no suena (iOS solo deja sonar en silencio pausando lo que escuchas): entonces avisa la vibración de la notificación. Con el iPhone bloqueado o en otra app, iOS congela las apps web y no puede sonar: para eso está el aviso de abajo.'

/** 900 → "15:00". */
function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** "lunes, 16 de noviembre a las 15:00". */
function whenText(d: Date): string {
  return `${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} a las ${clockText(d.getHours() * 60 + d.getMinutes())}`
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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
  const push = usePushStatus()
  const reminderStatus = useReminderStatus()
  const reminder = useReminder()
  const [reminderBusy, setReminderBusy] = useState(false)
  /** The time being typed, until it is saved. */
  const [reminderClock, setReminderClock] = useState<string | null>(null)
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

  async function toggleReminder(on: boolean) {
    setReminderBusy(true)
    try {
      if (on) await enableReminder(reminder)
      else await disableReminder()
    } catch (e) {
      await notify('No se pudo activar el aviso', errorText(e))
    } finally {
      setReminderBusy(false)
    }
  }

  async function saveReminderTime(text: string) {
    const match = /^(\d{1,2}):(\d{2})/.exec(text)
    const minutes = match ? Number(match[1]) * 60 + Number(match[2]) : NaN
    if (Number.isNaN(minutes) || minutes >= 24 * 60 || minutes === reminder.minutes) return
    setReminderBusy(true)
    try {
      await setReminderTime({ day: reminder.day, minutes })
    } catch (e) {
      await notify('No se pudo cambiar la hora del aviso', errorText(e))
    } finally {
      setReminderBusy(false)
    }
  }

  async function tryReminder() {
    try {
      await testReminder()
      await notify('Bloquea el iPhone', 'En 10 segundos te llegará el aviso para elegir qué grabar. Tócalo y se abrirá la página.')
    } catch (e) {
      await notify('No se pudo probar el aviso', errorText(e))
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

      {SHOW_SET_ONCE && (
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
          <p className="muted small-text">{PING_HELP}</p>
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
          {isNativeApp && <p className="muted small-text">{LIVE_ACTIVITY_HELP}</p>}
        </section>
      )}

      {SHOW_SET_ONCE && (
        <section className="card settings-section">
          <h2>Grabarte</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={reminderStatus === 'on'}
              disabled={reminderBusy || reminderStatus === 'no-server' || reminderStatus === 'not-installed'}
              onChange={(e) => void toggleReminder(e.target.checked)}
            />
            Aviso los lunes para elegir qué grabar
          </label>
          <label className="time-row">
            Hora del aviso
            <input
              type="time"
              className="time-input"
              value={reminderClock ?? clockText(reminder.minutes)}
              disabled={reminderBusy}
              onChange={(e) => setReminderClock(e.target.value)}
              onBlur={(e) => void saveReminderTime(e.target.value).finally(() => setReminderClock(null))}
            />
          </label>
          <p className="muted small-text">
            {reminderStatus === 'on'
              ? `Próximo aviso: ${whenText(nextReminderAt(reminder))}. Al tocarlo se abre «Grabar esta semana», que también está en Entrenar. En el entreno verás marcada la serie que te toca grabar.`
              : reminderStatus === 'off'
                ? 'Cada lunes a esa hora te llega un aviso para elegir los ejercicios que te toca grabar esa semana. En el entreno verás marcada su primera serie, o la que marques en la plantilla.'
                : PUSH_HELP[reminderStatus]}
          </p>
          {reminderStatus === 'on' && (
            <button className="btn full" onClick={() => void tryReminder()}>
              Probar el aviso de los lunes
            </button>
          )}
        </section>
      )}

      <section className="card settings-section">
        <h2>Ejercicios</h2>
        <span className="field-label" id="figure-label">
          Figura del cuerpo
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
        <p className="muted small-text">
          En la ficha de cada ejercicio muestra los músculos que trabaja, y en el Panel las series de cada músculo en la
          semana.
        </p>
      </section>

      {SHOW_SET_ONCE && (
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
      )}

      {SHOW_SET_ONCE && (
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
      )}

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
          {isNativeApp
            ? 'Los datos se guardan en esta app: si la borras del iPhone, se borran con ella.'
            : persisted === true
              ? 'Almacenamiento persistente activado: Safari no borrará los datos.'
              : persisted === false &&
                'Almacenamiento no persistente: instala la app en la pantalla de inicio y haz copias de seguridad.'}
        </p>
        <button className="btn danger full" disabled={busy} onClick={onDeleteAll}>
          Borrar todos los datos
        </button>
      </section>

      <p className="app-version muted small-text">
        Versión {__APP_VERSION__}
        {isNativeApp && ' · app para iPhone'} · {fmtDateTime(Date.parse(__BUILD_TIME__))}
      </p>
    </div>
  )
}

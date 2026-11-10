import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentDialog, subscribeDialog, type DialogOption, type DialogRequest } from '../lib/dialog'
import { DurationWheels } from './DurationWheels'

const STYLE_CLASS: Record<NonNullable<DialogOption<unknown>['style']>, string> = {
  primary: 'primary',
  tinted: 'primary-outline',
  danger: 'danger-solid',
  'danger-tinted': 'danger',
  plain: '',
}

/** Shows the dialog asked for with choose(), confirmDialog(), notify() or askText() from lib/dialog. */
export function DialogHost() {
  const req = useSyncExternalStore(subscribeDialog, currentDialog)
  return req ? <DialogView key={req.id} req={req} /> : null
}

function DialogView({ req }: { req: DialogRequest }) {
  const [text, setText] = useState(req.input?.initial ?? '')
  const [seconds, setSeconds] = useState(req.duration?.initial ?? 0)
  const first = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (input.current) {
      input.current.focus()
      input.current.select()
    } else {
      first.current?.focus()
    }
  }, [])

  const pick = (value: unknown) => {
    if (req.input) return req.resolve(value === true ? text : value === false ? null : value)
    if (req.duration) return req.resolve(value === true ? seconds : value === false ? null : value)
    req.resolve(value)
  }

  return (
    <div className="dialog-backdrop" onClick={() => req.resolve(null)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{req.title}</h2>
        {req.message && <p>{req.message}</p>}
        {req.input && (
          <input
            ref={input}
            value={text}
            placeholder={req.input.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') pick(true)
            }}
          />
        )}
        {req.duration && (
          <DurationWheels seconds={seconds} step={req.duration.step} max={req.duration.max} onChange={setSeconds} />
        )}
        <div className="dialog-actions">
          {req.options.map((o, i) => (
            <button
              key={i}
              ref={i === 0 ? first : undefined}
              className={`btn full ${STYLE_CLASS[o.style ?? 'plain']} ${o.detail ? 'with-detail' : ''}`}
              onClick={() => pick(o.value)}
            >
              {o.label}
              {o.detail && <small>{o.detail}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

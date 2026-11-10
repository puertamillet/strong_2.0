import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentDialog, subscribeDialog, type DialogRequest } from '../lib/dialog'

/** Shows the dialog asked for with choose(), confirmDialog(), notify() or askText() from lib/dialog. */
export function DialogHost() {
  const req = useSyncExternalStore(subscribeDialog, currentDialog)
  return req ? <DialogView key={req.id} req={req} /> : null
}

function DialogView({ req }: { req: DialogRequest }) {
  const [text, setText] = useState(req.input?.initial ?? '')
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

  const pick = (value: unknown) => req.resolve(req.input && value === true ? text : value === false && req.input ? null : value)

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
        <div className="dialog-actions">
          {req.options.map((o, i) => (
            <button
              key={i}
              ref={i === 0 ? first : undefined}
              className={`btn full ${o.style === 'primary' ? 'primary' : o.style === 'danger' ? 'danger-solid' : ''}`}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

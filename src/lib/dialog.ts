/**
 * In-app dialogs that replace confirm(), alert() and prompt(), styled like the rest
 * of the app. Each helper returns a promise with the chosen value; tapping outside
 * or the cancel option resolves to null (or false).
 */
export interface DialogOption<T> {
  label: string
  value: T
  style?: 'primary' | 'danger' | 'plain'
}

export interface DialogRequest {
  id: number
  title: string
  message?: string
  options: DialogOption<unknown>[]
  input?: { initial: string; placeholder?: string }
  /** Minutes and seconds wheels, in steps of `step` seconds up to `max`. */
  duration?: { initial: number; step: number; max: number }
  resolve: (value: unknown) => void
}

let current: DialogRequest | null = null
let nextId = 1
const listeners = new Set<() => void>()

function show(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<unknown> {
  current?.resolve(null)
  return new Promise((resolve) => {
    const id = nextId++
    current = {
      ...req,
      id,
      resolve: (value) => {
        if (current?.id === id) current = null
        listeners.forEach((l) => l())
        resolve(value)
      },
    }
    listeners.forEach((l) => l())
  })
}

export function choose<T>(title: string, options: DialogOption<T>[], message?: string): Promise<T | null> {
  return show({ title, message, options }) as Promise<T | null>
}

export async function confirmDialog(opts: {
  title: string
  message?: string
  confirm: string
  cancel?: string
  danger?: boolean
}): Promise<boolean> {
  const value = await choose(
    opts.title,
    [
      { label: opts.confirm, value: true, style: opts.danger ? 'danger' : 'primary' },
      { label: opts.cancel ?? 'Cancelar', value: false },
    ],
    opts.message,
  )
  return value === true
}

export async function notify(title: string, message?: string): Promise<void> {
  await choose(title, [{ label: 'Vale', value: true, style: 'primary' }], message)
}

/** Asks for a line of text. Resolves to the trimmed text, or null if cancelled or empty. */
export async function askText(title: string, initial = '', confirm = 'Guardar', placeholder?: string): Promise<string | null> {
  const value = await show({
    title,
    input: { initial, placeholder },
    options: [
      { label: confirm, value: true, style: 'primary' },
      { label: 'Cancelar', value: false },
    ],
  })
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Asks for a rest with minute and second wheels (10 s steps by default). Resolves to the
 * seconds chosen (0 for "Sin descanso"), or null if cancelled.
 */
export async function pickDuration(
  title: string,
  initial: number,
  opts: { message?: string; step?: number; max?: number } = {},
): Promise<number | null> {
  const value = await show({
    title,
    message: opts.message,
    duration: { initial, step: opts.step ?? 10, max: opts.max ?? 600 },
    options: [
      { label: 'Guardar', value: true, style: 'primary' },
      { label: 'Sin descanso', value: 0 },
      { label: 'Cancelar', value: false },
    ],
  })
  return typeof value === 'number' ? value : null
}

export function subscribeDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function currentDialog(): DialogRequest | null {
  return current
}

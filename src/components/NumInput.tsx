import { useState } from 'react'
import { fmtNumber, parseNum } from '../lib/format'

interface Props {
  value: number | null
  placeholder?: string
  onChange: (v: number | null) => void
  decimal?: boolean
  className?: string
  ariaLabel?: string
}

/**
 * Numeric input that keeps the typed text while focused (so "22," or "22." are not
 * rewritten mid-typing) and accepts a comma as decimal separator.
 */
export function NumInput({ value, placeholder, onChange, decimal = true, className, ariaLabel }: Props) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      className={className}
      aria-label={ariaLabel}
      inputMode={decimal ? 'decimal' : 'numeric'}
      placeholder={placeholder}
      value={text ?? fmtNumber(value)}
      onFocus={(e) => {
        setText(fmtNumber(value))
        e.target.select()
      }}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseNum(e.target.value))
      }}
      onBlur={() => setText(null)}
    />
  )
}

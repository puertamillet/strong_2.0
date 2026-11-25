import { useState, type ChangeEvent } from 'react'

/**
 * A text field whose text is saved to the database and only comes back a moment later, as in the
 * workout in progress. Each key shows what is typed straight away, not the saved text: otherwise
 * the old text came back for an instant after every key, the iPhone moved the cursor to the end,
 * and the next key changed the end of the text instead of where it was being edited (and keys
 * typed quickly were lost). After leaving the field it shows the saved text again.
 *
 * Returns `value`, `onChange` and `onBlur` for an <input> or a <textarea>.
 */
export function useTypedText(saved: string, save: (text: string) => void) {
  const [typed, setTyped] = useState<string | null>(null)
  return {
    value: typed ?? saved,
    onChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
      setTyped(e.target.value)
      save(e.target.value)
    },
    onBlur() {
      setTyped(null)
    },
  }
}

/**
 * Minimal RFC 4180 CSV reader/writer. Handles quoted fields with embedded
 * delimiters, quotes ("") and newlines, a UTF-8 BOM, CRLF line endings, and
 * auto-detects "," or ";" as delimiter from the header line.
 * With `quoted`, it also fills in which fields were written in quotes, row by row.
 */
export function parseCsv(input: string, quoted?: boolean[][]): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const nl = text.indexOf('\n')
  const header = nl === -1 ? text : text.slice(0, nl)
  const delim = count(header, ';') > count(header, ',') ? ';' : ','

  const rows: string[][] = []
  const quotes: boolean[][] = []
  let row: string[] = []
  let rowQuotes: boolean[] = []
  let field = ''
  let fieldQuoted = false
  let inQuotes = false
  const endField = () => {
    row.push(field)
    rowQuotes.push(fieldQuoted)
    field = ''
    fieldQuoted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    quotes.push(rowQuotes)
    row = []
    rowQuotes = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
      fieldQuoted = true
    } else if (c === delim) {
      endField()
    } else if (c === '\n') {
      endRow()
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || fieldQuoted || row.length > 0) endRow()
  const keep = rows.map((r) => !(r.length === 1 && r[0].trim() === ''))
  quoted?.push(...quotes.filter((_, i) => keep[i]))
  return rows.filter((_, i) => keep[i])
}

function count(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n'
}

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

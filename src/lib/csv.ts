/**
 * Minimal RFC 4180 CSV reader/writer. Handles quoted fields with embedded
 * delimiters, quotes ("") and newlines, a UTF-8 BOM, CRLF line endings, and
 * auto-detects "," or ";" as delimiter from the header line.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const nl = text.indexOf('\n')
  const header = nl === -1 ? text : text.slice(0, nl)
  const delim = count(header, ';') > count(header, ',') ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

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
    } else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
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

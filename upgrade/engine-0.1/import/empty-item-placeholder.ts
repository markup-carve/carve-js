const PLACEHOLDER = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*]|(?:\d+|[ivxlcdm]+|[IVXLCDM]+|[A-Za-z])[.)]|\.|:|\[\^[^\]\n]+\]:) +(?:\[[ xX_>/!?-]\] +)?)+)\+[ \t]*$/
const FENCE = /^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})/

/**
 * The importers build an empty item as `- +`. A bare `+` is a letter unless a block
 * stands at its marker column (carve#4396), so the converted text never keeps it:
 * the body below moves up to the marker line, and an item with no body takes `{empty}`.
 */
export function spellEmptyItemPlaceholders(text: string): string {
  if (!text.includes('+')) return text
  const lines = text.split('\n')
  const out: string[] = []
  const loose = new Map<number, string>()
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const run = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (run !== undefined && run[0] === fence[0] && run.length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (run !== undefined) fence = run
    const placeholder = PLACEHOLDER.exec(line)
    if (placeholder === null) {
      out.push(line)
      continue
    }
    const prefix = placeholder[1]!
    const content = prefix.replace(/[^> \t]/g, ' ')
    const next = lines[i + 1]
    if (next !== undefined && next.startsWith(content) && next.length > content.length && !/[ \t]/.test(next[content.length]!)) {
      // The merged line is read again: it can open a fence or hold a placeholder of its own.
      lines[i + 1] = prefix + next.slice(content.length)
    } else {
      // `{empty}` would attribute a block below it, and a task's body column is short of its box.
      const box = /\[[ xX_>/!?-]\] +$/.exec(prefix)?.[0].length ?? 0
      const body = content.slice(0, content.length - box)
      let below = i + 1
      while (lines[below]?.trim() === '') below++
      const holdsBody = lines[below]?.startsWith(body) === true
      out.push(`${prefix}${holdsBody ? '%%' : '{empty}'}`)
      // A blank after an invisible lead no longer loosens (carve#4639), so the list says `{loose}` itself.
      if (holdsBody && below > i + 1) markLoose(lines, i, prefix, loose)
    }
  }
  if (loose.size === 0) return out.join('\n')
  return out.flatMap((line, index) => loose.has(index) ? [loose.get(index)!, line] : [line]).join('\n')
}

const ONE_MARKER = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-*]|(?:\d+|[ivxlcdm]+|[IVXLCDM]+|[A-Za-z])[.)]) /

function markLoose(lines: readonly string[], at: number, prefix: string, loose: Map<number, string>): void {
  const head = ONE_MARKER.exec(prefix)
  // A list opened after another marker on the same line has no line of its own to carry `{loose}`.
  if (head === null || ONE_MARKER.test(prefix.slice(head[0].length).replace(/^ +/, '')) || /^ *\[\^/.test(prefix.slice(head[0].length))) return
  const quote = head[1]!, column = head[2]!.length
  let start = at
  for (let j = at - 1; j >= 0; j--) {
    const line = lines[j]!
    if (!line.startsWith(quote)) break
    const rest = line.slice(quote.length)
    if (rest.trim() === '') continue
    const indent = rest.length - rest.trimStart().length
    if (indent > column) continue
    const marker = ONE_MARKER.exec(line)
    if (indent === column && marker !== null && marker[1] === quote && sameListKind(marker[3]!, head[3]!)) { start = j; continue }
    break
  }
  if (/^[ \t]*\{loose\}[ \t]*$/.test((lines[start - 1] ?? '').slice(quote.length))) return
  // Directly below a line of another list, `{loose}` would be that item's lazy text.
  const above = lines[start - 1]
  const gap = above !== undefined && above.slice(quote.length).trim() !== '' ? quote.trimEnd() + '\n' : ''
  loose.set(start, gap + quote + ' '.repeat(column) + '{loose}')
}

function sameListKind(a: string, b: string): boolean {
  if (a.at(-1) !== b.at(-1)) return false
  const kinds = (marker: string): string[] => {
    const label = marker.slice(0, -1)
    if (label === '') return [marker]
    if (/^\d+$/.test(label)) return ['1']
    const out: string[] = []
    if (/^[ivxlcdm]+$/.test(label)) out.push('i')
    if (/^[IVXLCDM]+$/.test(label)) out.push('I')
    if (/^[a-z]$/.test(label)) out.push('a')
    if (/^[A-Z]$/.test(label)) out.push('A')
    return out
  }
  const other = kinds(b)
  return kinds(a).some(kind => other.includes(kind))
}

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
    }
  }
  return out.join('\n')
}

/** Candidate spellings for upgrade rows added after the first replay. The render check decides them. */
export interface Candidate { id: string; output: string }

function alignedRows(lines: string[], start: number, marks: string[]): { index: number; value: string }[] | null {
  const rows: { index: number; value: string }[] = []
  for (let at = start; at < lines.length && lines[at]?.trimStart().startsWith('|'); at++) {
    const value = lines[at]!
    if (!/^\s*\|.*\|\s*$/u.test(value) || value.includes('\\|')) return null
    const cells = value.split('|')
    if (cells.length - 2 !== marks.length) return null
    const rewritten = cells.map((cell, index) => index > 0 && index < cells.length - 1 && marks[index - 1] !== ''
      ? `{${marks[index - 1]}}${cell}` : cell).join('|')
    rows.push({ index: at, value: rewritten })
  }
  return rows
}

/** Convert a table's column alignment default to marks on each cell. */
function tableAlignment(input: string): string | null {
  const lines = input.split('\n')
  let changed = false
  for (let line = 0; line < lines.length - 1; line++) {
    const match = /\baligns="([^"]*)"/u.exec(lines[line]!)
    if (match === null || !lines[line + 1]?.trimStart().startsWith('|')) continue
    const marks = match[1]!.split(',').map((align) => ({ left: '<', right: '>', center: '~' })[align] ?? '')
    const rows = alignedRows(lines, line + 1, marks)
    if (rows === null) return null
    if (rows.length === 0) continue
    lines[line] = lines[line]!.replace(match[0], '').replace(/\{\s+/u, '{').replace(/\s+\}/u, '}')
    if (lines[line] === '{}') lines[line] = ''
    for (const row of rows) lines[row.index] = row.value
    changed = true
  }
  return changed ? lines.join('\n').replace(/^\n/gu, '') : null
}

export function newMapCandidates(input: string): Candidate[] {
  const candidates: Candidate[] = []
  const quote = input.replace(/([-\/–—])(["'])/gu,
    (_span, before: string, mark: string) => before + (mark === '"' ? '“' : '‘'))
  if (quote !== input) candidates.push({ id: 'U-375', output: quote })
  const abbreviation = input.replace(/^(\s*\*\[[^\]\n]+\]:) {2,}/gmu, '$1 ')
  if (abbreviation !== input) candidates.push({ id: 'U-376', output: abbreviation })
  const table = input.includes('aligns="') ? tableAlignment(input) : null
  if (table !== null) candidates.push({ id: 'U-377', output: table })
  return candidates
}

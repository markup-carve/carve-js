import { htmlTokens } from './compare.ts'

interface Result { html: string; applied: string[] }

function trailingCounts(input: string): number[] {
  const lines = input.split('\n')
  if (lines[0] !== '::: |') return []
  const counts: number[] = []
  for (let at = 1; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (line.trim() === ':::') break
    if (line.trim() === '') continue
    counts.push(line.length - line.trimEnd().length)
  }
  return counts
}

function lineTextIndices(tokens: readonly string[]): number[] {
  const start = tokens.indexOf('<div class="line-block">')
  const end = tokens.indexOf('</div>', start)
  if (start < 0 || end < 0) return []
  const indices: number[] = []
  for (let at = start + 1; at < end; at++) {
    const token = tokens[at] ?? ''
    if (token !== '' && !token.startsWith('<')) indices.push(at)
  }
  return indices
}

/** C2-H-043: only leading spaces of a line block become no-break spaces. */
export function removeTrailingLineBlockSpaces(input: string, old: string, next: string): Result {
  const unchanged = { html: old, applied: [] }
  const counts = trailingCounts(input)
  if (counts.length === 0 || counts.every((count) => count === 0)) return unchanged
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  const indices = lineTextIndices(source)
  if (indices.length !== counts.length) return unchanged
  for (let at = 0; at < indices.length; at++) {
    const index = indices[at]
    const value = index === undefined ? undefined : source[index]
    const count = counts[at] ?? 0
    if (value === undefined || index === undefined) return unchanged
    const suffix = '&nbsp;'.repeat(count)
    if (count > 0 && !value.endsWith(suffix)) return unchanged
    const stripped = count > 0 ? value.slice(0, -suffix.length) : value
    if (target[index] !== stripped) return unchanged
    source[index] = stripped
  }
  return { html: source.join(''), applied: ['U-130'] }
}

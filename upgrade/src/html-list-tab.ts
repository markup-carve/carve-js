import { htmlTokens } from './compare.ts'

interface Result { html: string; applied: string[] }

/** C2-B-027, C2-B-033: marker padding is absent from the 0.2 item text. */
export function removeListMarkerTab(input: string, old: string, next: string): Result {
  const unchanged = { html: old, applied: [] }
  if (!input.split('\n').some((line) => line.startsWith('- \t') || line.startsWith('* \t'))) return unchanged
  const source = htmlTokens(old)
  const target = htmlTokens(next)
  let changed = false
  for (let at = 1; at < source.length; at++) {
    const value = source[at]
    if (source[at - 1] !== '<li>' || value === undefined || !value.startsWith('\t')) continue
    if (target[at] !== value.slice(1)) continue
    source[at] = value.slice(1)
    changed = true
  }
  return { html: changed ? source.join('') : old, applied: changed ? ['U-153'] : [] }
}

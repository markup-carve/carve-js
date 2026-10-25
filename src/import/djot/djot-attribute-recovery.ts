import { maskDjotCodeAndDestinations, isDjotEscaped } from '../../djot-migrate.js'
import { readAttributes } from './djot-attributes.js'

export type RecoveredAttributeLoss = { code: 'djot-attribute-dropped'; message: string; line: number }

/** Recover the parts of a Djot attribute block that Carve can spell. */
export function recoverDjotAttributes(source: string): { source: string; losses: RecoveredAttributeLoss[] } {
  if (!source.includes('{')) return { source, losses: [] }
  const mask = maskDjotCodeAndDestinations(source)
  const losses: RecoveredAttributeLoss[] = []
  const pieces: string[] = []
  let copied = 0
  let line = 1
  let prior = 0
  for (const match of source.matchAll(/\{([^{}\n]*)\}/g)) {
    const at = match.index!
    line += (source.slice(prior, at).match(/\n/g) ?? []).length
    prior = at
    if (mask[at] !== '{' || isDjotEscaped(source, at) || readAttributes(source, at)) continue
    const inner = match[1]!
    if (inner.includes('\0') || !/^[\s.#A-Za-z]/.test(inner) || !/[#.]/.test(inner)) continue
    const tokens = inner.match(/#[^\s.#{}]+|\.[^\s.#{}]+|[A-Za-z][A-Za-z0-9_-]*=(?:"(?:\\.|[^"])*"|[^\s{}]+)|[^\s{}]+/g) ?? []
    if (!tokens.length || tokens.some(token => !/^[#.]/.test(token) && !readAttributes(`{${token}}`, 0))) continue
    const kept: string[] = []
    const rejected: string[] = []
    for (const token of tokens) {
      if (readAttributes(`{${token}}`, 0) && (!/^[#.]/.test(token) || /^[#.][A-Za-z0-9_][\w-]*$/.test(token))) kept.push(token)
      else rejected.push(token.startsWith('#') ? 'id' : token.startsWith('.') ? 'class' : token.split('=')[0]!)
    }
    if (!rejected.length && kept.join(' ') === inner.trim()) continue
    const replacement = `{${kept.join(' ')}}`
    if (!readAttributes(replacement, 0)) continue
    pieces.push(source.slice(copied, at), replacement)
    copied = at + match[0].length
    for (const name of rejected) losses.push({ code: 'djot-attribute-dropped', message: `Djot attribute ${name} could not be represented in Carve and was dropped.`, line })
  }
  if (copied === 0) return { source, losses }
  pieces.push(source.slice(copied))
  return { source: pieces.join(''), losses }
}

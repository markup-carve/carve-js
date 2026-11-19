import { maskDjotCodeAndDestinations, isDjotEscaped } from '../../djot-migrate.js'
import { readAttributes } from './djot-attributes.js'
import { escapePlainCarveInlineSyntaxAround, HANDLED_DJOT } from '../../carve-escape.js'

function unmaskLiftedDjotAutolinkBodies(source: string, masked: string): string {
  if (!source.includes('<') || !source.includes('\x00')) return masked
  const visible = maskDjotCodeAndDestinations(source, true, true, true, undefined, [], {
    autolinks: false,
    comments: false,
  })
  const chars = masked.split('')
  for (const match of source.matchAll(/<[^<>\s]+>/g)) {
    const at = match.index!,
      value = match[0]
    if (!value.includes('\x00') || visible[at] !== '<' || masked.slice(at, at + value.length).trim() !== '') continue
    for (let i = 0; i < value.length; i++) chars[at + i] = value[i]!
  }
  return chars.join('')
}

/** Escape plain Djot text while leaving code spans, fences and destinations opaque. */
export function escapePlainDjotText(source: string): string {
  let masked = unmaskLiftedDjotAutolinkBodies(source, maskDjotCodeAndDestinations(source))
  if (source.includes('{')) {
    const chars = masked.split('')
    for (let at = 0; at < source.length; at++) {
      if (chars[at] !== '{' || isDjotEscaped(source, at)) continue
      const attrs = readAttributes(source, at)
      if (!attrs) continue
      for (let i = at; i < attrs.end; i++) if (chars[i] !== '\n') chars[i] = ' '
      at = attrs.end - 1
    }
    masked = chars.join('')
  }
  const bangs = [...source.matchAll(/!(?=`)/g)].map(match => match.index!).filter(at => masked[at] === '!' && !isDjotEscaped(source, at))
  for (const at of bangs.reverse()) {
    source = source.slice(0, at) + '\\' + source.slice(at)
    masked = masked.slice(0, at) + '\\' + masked.slice(at)
  }
  // The mask writes a space over each opaque character and keeps real spaces.
  return escapePlainCarveInlineSyntaxAround(
    source, at => masked[at] === ' ' && source[at] !== ' ' && source[at] !== '\n', HANDLED_DJOT)
}


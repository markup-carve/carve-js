// The attribute blocks a block took, read from their source spans into the fields of C2-A-032.
import { type AttributeMemo, type AttributeSink, readAttributeBlock } from './attributes.ts'
import { BRACE_OPEN, GREATER, LESS, TILDE } from './chars.ts'

export const NO_MEMO: AttributeMemo = { doubleQuoteFailEnd: -1, singleQuoteFailEnd: -1, valueFailEnd: -1 }

/** The merged attribute blocks of a host, in the fixed order of C2-I-041. */
export interface Attributes {
  id: string | null
  classes: string[]
  language: string | null
  keys: [string, string][]
}

/** C2-I-079: every run of spaces, tabs and a line break is one space, and the ends are trimmed. */
export function foldLabel(source: string): string {
  return source.replaceAll(/[ \t\n]+/g, ' ').trim()
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** C2-I-039, C2-I-042: adds the parts of one block to `attributes`. */
export function attributeSink(attributes: Attributes): AttributeSink {
  const sink: AttributeSink = {
    id: (name) => {
      attributes.id = name
    },
    className: (name) => {
      attributes.classes.push(name)
    },
    language: (tag) => {
      attributes.language = tag
    },
    key: (key, value) => {
      if (sameName(key, 'id')) return sink.id(value)
      if (sameName(key, 'class')) {
        for (const name of value.split(/[ \t]+/)) if (name !== '') attributes.classes.push(name)
        return
      }
      // A later key replaces an earlier one of the same name, at its first place (C2-A-035).
      const earlier = attributes.keys.find((pair) => sameName(pair[0], key))
      if (earlier === undefined) attributes.keys.push([key, value])
      else earlier[1] = value
    },
  }
  return sink
}

export function emptyAttributes(): Attributes {
  return { id: null, classes: [], language: null, keys: [] }
}

/** C2-B-093: adds the glued blocks that start at `pos` to `attributes` and returns the offset behind them. */
export function readGluedBlocks(src: string, pos: number, end: number, attributes: Attributes): number {
  const sink = attributeSink(attributes)
  while (pos < end && src.charCodeAt(pos) === BRACE_OPEN) {
    const first = src.charCodeAt(pos + 1)
    // C2-B-182: the alignment mark of a cell prefix stands before the parts and is none of them.
    const marked = first === LESS || first === GREATER || first === TILDE
    const next = readAttributeBlock(src, marked ? pos + 1 : pos, end, NO_MEMO, sink)
    if (next < 0) {
      const close = marked ? src.indexOf('}', pos) : -1
      if (close < 0 || close >= end) break
      pos = close + 1
    } else {
      pos = next
    }
  }
  return pos
}

/** C2-B-102: the attribute lines of a block, merged in the order written. `spans` holds a start and an end per line. */
export function readAttributeLines(src: string, spans: number[] | null): Attributes | null {
  if (spans === null || spans.length === 0) return null
  const attributes = emptyAttributes()
  for (let at = 0; at < spans.length; at += 2) readGluedBlocks(src, spans[at]!, spans[at + 1]!, attributes)
  return attributes
}

/** Removes the key `name` from `attributes` and returns its value, or null when it is not there. */
export function takeKey(attributes: Attributes | null, name: string): string | null {
  if (attributes === null) return null
  const at = attributes.keys.findIndex((pair) => pair[0] === name)
  if (at < 0) return null
  return attributes.keys.splice(at, 1)[0]![1]
}

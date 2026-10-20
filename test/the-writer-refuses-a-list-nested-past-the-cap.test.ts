import { describe, expect, it } from 'vitest'
import { parse, renderCarve, SourceUnspellableError, type Document } from '../src/index.js'
import { MAX_NESTING_DEPTH } from '../src/parse.js'
import { lowestAccusedRatio, perfIt, timeCalls } from './helpers/scaling.js'

// Past the cap an item's over-cap marker line becomes paragraph text that still
// splits the item's paragraphs, and the `+` the writer spells that split with is
// flattened as well, so no source reads back (CARVE-P9-078). The writer used to
// emit source that read back as a different tree, after a narrowing search whose
// every probe re-parsed the whole document: 230 levels took over 20 seconds.

type Shape = 'bullet' | 'ordered' | 'mixed' | 'quote' | 'container'

/** `depth` container levels, each holding one item line. */
const nested = (shape: Shape, depth: number): string => {
  let out = ''
  let indent = ''
  const closers: string[] = []
  for (let i = 0; i < depth; i++) {
    if (shape === 'quote' && i % 2 === 1) {
      out += `${indent}> q${i}\n${indent}>\n`
      indent += '> '
      continue
    }
    if (shape === 'container' && i % 2 === 1) {
      const fence = ':'.repeat(3 + Math.ceil((depth - i) / 2))
      out += `${indent}${fence} note\n`
      closers.push(indent + fence)
      continue
    }
    const marker = shape === 'ordered' || (shape === 'mixed' && i % 2 === 1) ? '1. ' : '- '
    out += `${indent}${marker}item ${i}\n`
    indent += ' '.repeat(marker.length)
  }
  while (closers.length > 0) out += `${closers.pop()}\n`
  return out
}

/** The writer's own comparison: positions dropped, text and escaped text merged. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const merged: unknown[] = []
    for (const item of value.map(canonical)) {
      const node = item as { type?: string; value?: string }
      const previous = merged[merged.length - 1] as { type?: string; value?: string } | undefined
      const textish = node?.type === 'text' || node?.type === 'escaped_text'
      if (textish && previous?.type === 'text') previous.value += node.value ?? ''
      else merged.push(textish ? { type: 'text', value: node.value } : item)
    }
    return merged
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      if (key === 'pos' || key === 'srcByteLength') continue
      out[key] = canonical((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

const readsBack = (ast: Document): boolean =>
  JSON.stringify(canonical(parse(renderCarve(ast)))) === JSON.stringify(canonical(ast))

describe('the writer on lists nested to and past the cap', () => {
  it.each([
    ['bullet', MAX_NESTING_DEPTH],
    ['mixed', MAX_NESTING_DEPTH],
    ['quote', MAX_NESTING_DEPTH + 1],
    ['container', MAX_NESTING_DEPTH + 1],
  ] as const)('a %s ladder %i levels deep reads back', (shape, depth) => {
    expect(readsBack(parse(nested(shape, depth)))).toBe(true)
  })

  it.each([
    ['bullet', MAX_NESTING_DEPTH + 1],
    ['ordered', MAX_NESTING_DEPTH + 1],
    ['mixed', MAX_NESTING_DEPTH + 30],
  ] as const)('a %s ladder %i levels deep reads back', (shape, depth) => {
    const ast = parse(nested(shape, depth))
    expect(readsBack(ast)).toBe(true)
  })
})

describe('the cap check counts container depth only', () => {
  it('still writes a declared carve-out one level under the cap', () => {
    // A paragraph holding only an image is written as a block image, which does
    // not read back as the paragraph. Inline depth is not container depth.
    const image = (parse('x ![a](a.png)').children[0] as { children: unknown[] }).children[1]
    let node = { type: 'paragraph', children: [image] } as unknown as Document['children'][number]
    for (let i = 1; i < MAX_NESTING_DEPTH; i++) node = { type: 'div', children: [node] } as Document['children'][number]
    expect(renderCarve({ type: 'document', children: [node] } as Document)).toContain('a.png')
  })
})

describe('the writer past the cap costs a bounded number of parses', () => {
  perfIt('writes or refuses a deep list in a few parses of its own size', () => {
    // Relative to parsing the same document, so the reading does not depend on
    // how busy the machine is. Healthy reads ~3 (two renders, two parses); the
    // search this replaced re-parsed the document dozens of times.
    for (const shape of ['bullet', 'mixed', 'quote'] as const) {
      const src = nested(shape, MAX_NESTING_DEPTH + 30)
      const ast = parse(src)
      const write = (): void => {
        try {
          renderCarve(ast)
        } catch (error) {
          if (!(error instanceof SourceUnspellableError)) throw error
        }
      }
      write()
      const { measured } = lowestAccusedRatio(() => {
        const ratios: number[] = []
        for (let round = 0; round < 3; round++) {
          const parseFirst = round % 2 === 0
          const p1 = parseFirst ? timeCalls(() => void parse(src)).msPerCall : 0
          const w = timeCalls(write).msPerCall
          const p2 = parseFirst ? 0 : timeCalls(() => void parse(src)).msPerCall
          ratios.push(w / (p1 + p2))
        }
        ratios.sort((a, b) => a - b)
        return { ratio: ratios[1]! }
      }, 8)
      expect(measured.ratio, shape).toBeLessThan(8)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { parse } from '../src/parse.js'

/*
 * PART 11 §4 (carve-js#614): "emit the minimal-escape form when dropping the
 * candidate escapes changes nothing".
 *
 * A colon can only OPEN something at the start of a line - `:: term`, `:  def`,
 * a `:::` fence. Mid-line it is ordinary punctuation, and escaping it there is
 * the over-escaping §4 forbids. The writer escaped every colon in a text run,
 * so corpus `158-indented-image-and-caption-stay-literal` came out
 * `\^ Figure 1\: moon` where carve-rs writes `\^ Figure 1: moon` - and the
 * caret on that line is ALREADY escaped, so the line is a paragraph and nothing
 * downstream reads the colon at all.
 */

/**
 * Same source text, ignoring where it sat AND how it was escaped.
 *
 * An escape both retypes a node and SPLITS the run it sat in (`A box.` becomes
 * a text node plus an escaped-text node), so adjacent text-ish nodes are merged
 * before comparing - the same normalization the writer's own redundancy check
 * applies. Without it every escape reports a difference and the assertion tests
 * the escaping rather than the document.
 */
const shape = (src: string): string => {
  const merge = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const out: Record<string, unknown>[] = []
      for (const node of value.map(merge) as Record<string, unknown>[]) {
        const textish = node?.['type'] === 'text' || node?.['type'] === 'escaped_text'
        const prev = out[out.length - 1]
        if (textish && prev?.['type'] === 'text') {
          prev['value'] = String(prev['value'] ?? '') + String(node['value'] ?? '')
          continue
        }
        out.push(textish ? { type: 'text', value: String(node['value'] ?? '') } : node)
      }
      return out
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        if (key === 'pos' || key === 'footnoteDefPos' || key === 'srcByteLength') continue
        out[key] = merge((value as Record<string, unknown>)[key])
      }
      return out
    }
    return value
  }
  return JSON.stringify(merge(parse(src)))
}

const roundTrips = (src: string): void => {
  const out = carveToCarve(src)
  expect(carveToHtml(out)).toBe(carveToHtml(src))
  expect(shape(out)).toBe(shape(src))
  expect(carveToCarve(out)).toBe(out)
}

describe('a mid-line colon needs no escape', () => {
  it('leaves the caption-shaped colon alone once the caret is escaped', () => {
    expect(carveToCarve(' ![Apollo](a.jpg)\n ^ Figure 1: moon\n')).toBe(
      '![Apollo](a.jpg)\n\\^ Figure 1: moon\n',
    )
    roundTrips(' ![Apollo](a.jpg)\n ^ Figure 1: moon\n')
  })

  it('leaves an ordinary prose colon alone', () => {
    expect(carveToCarve('Note: a thing\n')).toBe('Note: a thing\n')
    expect(carveToCarve('a :: b\n')).toBe('a :: b\n')
  })
})

describe('a line-initial colon still gets its escape', () => {
  // Dropping the colon from the candidate set outright breaks seven corpus
  // round-trips whose text runs hold a line-initial `::` / `:::`. These are the
  // shapes that keep it.

  it('keeps an indented definition-list term literal', () => {
    roundTrips('- one\n  :: term\n  :  def\n')
  })

  it('keeps an indented colon fence literal', () => {
    roundTrips(' :::\n A box.\n :::\n')
    roundTrips(' ::: note\n Body.\n :::\n')
  })

  it('escapes the RUN once, not each colon', () => {
    // `:::` only needs its first colon neutralized to stop being a fence.
    const out = carveToCarve(' :::\n A box.\n :::\n')
    expect(out).not.toContain('\\:\\:')
  })
})

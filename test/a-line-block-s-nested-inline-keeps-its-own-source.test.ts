import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import { carveToCarve } from '../src/index.js'
import type { Document } from '../src/ast.js'

/**
 * A LINE BLOCK'S STANZA IS PARSED AS ONE INLINE RUN OVER THE JOINED BODY TEXT,
 * and the block layer has already emptied every comment-only line in it. So the
 * joined text is SHORTER than the source by exactly those lines, and anything
 * measured or captured from it past the first one is wrong.
 *
 * Two tickets, one cause, and they need different halves of the answer:
 *
 *   - carve-js#1182, the OFFSETS. `lineAnchors` gives every line its own
 *     origin, but `shiftSource` dropped them when it re-based a nested scan, so
 *     a node under an inline container fell back to `baseOffset + localOffset`.
 *     In `*a` / `%% secret` / `c*` that put `c` on the second `%` of the comment
 *     line.
 *
 *   - carve-js#1183, the CAPTURED TEXT. `rawRef` promises the authored source
 *     verbatim and the writer emits it unchanged, but it was sliced out of the
 *     joined text, so `[a` / `%% secret` / `c][missing]` captured
 *     `[a\n\nc][missing]` and `carve fmt` wrote the comment line back as a bare
 *     `%%`. Correct offsets do not fix that by themselves - the characters are
 *     not in the string being sliced - but they are what makes the document
 *     slice available, so the field is read from the source instead.
 *
 * THE CAPTURE VERIFIES ITSELF, which is the part a document slice gets wrong if
 * it is trusted. Container prefixes are stripped from this text deliberately: a
 * `> ` or a list item's indent is not part of the reference the author wrote.
 * The blockquote and list cases below are the near-miss - a naive "slice the
 * document" puts those markers back inside the label - and they must keep the
 * scanned spelling.
 */

// A block's children live under `children`, `items` or `blocks` depending on the
// node, so the walk asks for whichever one this node carries.
const kids = (node: unknown): unknown[] => {
  const record = node as Record<string, unknown>
  for (const slot of ['children', 'items', 'blocks']) {
    if (Array.isArray(record[slot])) return record[slot] as unknown[]
  }
  return []
}

const inlines = (doc: Document, path: number[]): { type: string; pos?: unknown }[] => {
  let node = kids(doc)[0]
  for (const i of path) node = kids(node)[i]
  return kids(node) as { type: string; pos?: unknown }[]
}

const spans = (src: string, path: number[]): Array<[string, string]> =>
  inlines(parse(src), path).map((n) => {
    const p = n.pos as { startOffset: number; endOffset: number } | undefined
    return [n.type, p === undefined ? '(no pos)' : src.slice(p.startOffset, p.endOffset)]
  })

const rawRefs = (src: string): string[] => {
  const found: string[] = []
  const walk = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    const record = x as Record<string, unknown>
    if (typeof record.rawRef === 'string') found.push(record.rawRef)
    for (const key of Object.keys(record)) walk(record[key])
  }
  walk(parse(src))
  return found
}

describe("a line block's nested inline keeps its own source", () => {
  describe('the offsets a nested node reports (carve-js#1182)', () => {
    it('the reported document measures every node from the line it was written on', () => {
      // `c` reported 10-11 on main: offset 10 is the second `%` of the comment
      // line, and `c` is at 19.
      const src = '::: |\n*a\n%% secret\nc*\n:::\n'
      expect(spans(src, [0, 0])).toEqual([
        ['text', 'a'],
        // HARDENED at every depth (markup-carve/carve#1351). The spelling moved
        // after this file was written; the spans are what it pins.
        ['hard_break', '\n'],
        ['comment', '%% secret'],
        ['hard_break', '\n'],
        ['text', 'c'],
      ])
    })

    it('the nested spans nest, so no two nodes claim one byte', () => {
      const src = '::: |\n*a\n%% secret\nc*\n:::\n'
      const strong = inlines(parse(src), [0])[0] as {
        pos: { startOffset: number; endOffset: number }
        children: { pos?: { startOffset: number; endOffset: number } }[]
      }
      let previousEnd = strong.pos.startOffset
      for (const child of strong.children) {
        expect(child.pos!.startOffset).toBeGreaterThanOrEqual(previousEnd)
        expect(child.pos!.endOffset).toBeLessThanOrEqual(strong.pos.endOffset)
        previousEnd = child.pos!.endOffset
      }
    })

    it('SURVIVOR: the TOP-LEVEL shape was already right and stays right', () => {
      // The ticket names this as the control: at the top level every break is
      // re-posed from line geometry and the spans already agreed.
      const src = '::: |\na\n%% secret\nc\n:::\n'
      expect(spans(src, [0])).toEqual([
        ['text', 'a'],
        ['hard_break', '\n'],
        ['comment', '%% secret'],
        ['hard_break', '\n'],
        ['text', 'c'],
      ])
    })

    it('SURVIVOR: a stanza with no emptied line is unchanged', () => {
      // Here the joined text and the source have the same length, so the naive
      // offset and the anchored one coincide. If this moved, the fix would be
      // changing something other than the defect.
      const src = '::: |\n*a\nbb\nc*\n:::\n'
      expect(spans(src, [0, 0])).toEqual([
        ['text', 'a'],
        ['hard_break', '\n'],
        ['text', 'bb'],
        ['hard_break', '\n'],
        ['text', 'c'],
      ])
    })

    it('every inline slot is measured, not just children', () => {
      // An inline footnote carries its body in `inline` and an inline extension
      // in `content`. Both round-trip, which they cannot do from a joined-text
      // offset.
      expect(carveToCarve('::: |\n^[a\n%% secret\nc]\n:::\n')).toBe(
        '::: |\n^[a\n%% secret\nc]\n:::\n',
      )
      expect(carveToCarve('::: |\n:kbd[a\n%% secret\nc]\n:::\n')).toBe(
        '::: |\n:kbd[a\n%% secret\nc]\n:::\n',
      )
    })

    it('a nested inline in a QUOTE is measured from its own line too', () => {
      // THE DEFECT IS NOT THE LINE BLOCK'S. `shiftSource` dropped the anchors
      // for every container that strips a per-line prefix, so a blockquote's
      // nested continuation line was measured from the STRIPPED text: `c` here
      // reported the span of the `>` marker on main, while the same quote's
      // top-level nodes were correct. The line block is only where an emptied
      // line made the drift visible in the output.
      const src = '> *a\n> c*\n'
      expect(spans(src, [0, 0])).toEqual([
        ['text', 'a'],
        ['soft_break', '\n> '],
        ['text', 'c'],
      ])
    })

    it('and in a list item, and in a list inside a quote', () => {
      // `c` reported a lone space on main in the first, and `>` in the second.
      const item = '- *a\n  c*\n'
      expect(spans(item, [0, 0, 0])).toEqual([
        ['text', 'a'],
        ['soft_break', '\n  '],
        ['text', 'c'],
      ])
      const quoted = '> - *a\n>   c*\n'
      expect(spans(quoted, [0, 0, 0, 0])).toEqual([
        ['text', 'a'],
        ['soft_break', '\n>   '],
        ['text', 'c'],
      ])
    })

    it('SURVIVOR: the same quote measured at the TOP level was already right', () => {
      // The control that says the anchors reached one depth and stopped.
      const src = '> a\n> c\n'
      expect(spans(src, [0])).toEqual([
        ['text', 'a'],
        ['soft_break', '\n> '],
        ['text', 'c'],
      ])
    })
  })

  describe('the source a reference captures (carve-js#1183)', () => {
    it('rawRef is the authored source, comment line and all', () => {
      const src = '::: |\n[a\n%% secret\nc][missing]\n:::\n'
      expect(rawRefs(src)).toEqual(['[a\n%% secret\nc][missing]'])
      // `carve fmt` writes `rawRef` verbatim, so the author's line comes back.
      expect(carveToCarve(src)).toBe(src)
    })

    it('the image form captures the same way', () => {
      // A second capture site, and it had the same defect.
      const src = '::: |\n![a\n%% secret\nc][missing]\n:::\n'
      expect(rawRefs(src)).toEqual(['![a\n%% secret\nc][missing]'])
      expect(carveToCarve(src)).toBe(src)
    })

    it('NEAR MISS: a quoted reference does NOT take the markers back', () => {
      // The document slice here is `[a\n> c][missing]`. Accepting it would put
      // the quote marker inside the label, which is the failure a naive
      // source capture ships. The scanned spelling is the right answer.
      expect(rawRefs('> [a\n> c][missing]\n')).toEqual(['[a\nc][missing]'])
      expect(carveToCarve('> [a\n> c][missing]\n')).toBe('> [a\n> c][missing]\n')
    })

    it('NEAR MISS: an item-indented reference does NOT take the indent back', () => {
      expect(rawRefs('- [a\n  c][missing]\n')).toEqual(['[a\nc][missing]'])
      expect(carveToCarve('- [a\n  c][missing]\n')).toBe('- [a\n  c][missing]\n')
    })

    it('SURVIVOR: a single-line reference is untouched', () => {
      expect(rawRefs('[a][missing]\n')).toEqual(['[a][missing]'])
    })

    it('SURVIVOR: a RESOLVED reference has no rawRef to prefer', () => {
      const src = '::: |\n[a\n%% secret\nc](/u)\n:::\n'
      expect(rawRefs(src)).toEqual([])
      expect(carveToCarve(src)).toBe(src)
    })

    it('a CRLF document restores the same line', () => {
      // Offsets index the RAW source, endings and all, while every line the
      // scanner walks is already normalized - so the candidate and the scanned
      // text differ on every line of a CRLF document unless both are read the
      // same way. Without that, this shape kept `[a\n\nc][missing]` and `fmt`
      // still wrote a bare `%%` (raised by `codex review`).
      const src = '::: |\r\n[a\r\n%% secret\r\nc][missing]\r\n:::\r\n'
      expect(rawRefs(src)).toEqual(['[a\n%% secret\nc][missing]'])
      expect(carveToCarve(src)).toContain('%% secret')
    })

    it('NEAR MISS: a CRLF quoted reference still keeps its stripped spelling', () => {
      // Normalizing endings must not soften the prefix test that keeps a quote
      // marker out of the label.
      expect(rawRefs('> [a\r\n> c][missing]\r\n')).toEqual(['[a\nc][missing]'])
    })

    it('an astral character does not shift the captured span', () => {
      // Spans hold UTF-16 indices while parsing and are converted to codepoints
      // once at the end, so the capture needs no conversion - and would be
      // truncated by one character per astral codepoint if it applied one.
      const src = '::: |\n[\u{1F600}a\n%% secret\nc][missing]\n:::\n'
      expect(rawRefs(src)).toEqual(['[\u{1F600}a\n%% secret\nc][missing]'])
      expect(carveToCarve(src)).toBe(src)
    })
  })
})

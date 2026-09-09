import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A TRAILING LINE AFTER A CONSUMED DEFINITION IN A STACK OF NESTED NOTES
 * (carve-js#1653, ruled canonical in markup-carve/carve#1946, pinned by the
 * corpus section added in markup-carve/carve#1959).
 *
 * The stack is three footnote definitions, each shallower marker one note, with
 * a link definition and a trailing word below the innermost. The link
 * definition is consumed (so `[t][r]` resolves) and the innermost `[^h]` is a
 * real third note. The open question is which note owns the trailing line.
 *
 * A note's body column is measured from its OWN marker (two columns past it).
 * When the inner marker sits one column shy of the mid note's body column (the
 * `i < m+2` geometry), the inner note keeps a residual marker indent, so a
 * trailing line that does not reach the inner note's own content column is NOT
 * claimed by it and falls to the surviving ancestor note. This engine used a
 * fixed two-column body margin and let the innermost note over-reach, taking a
 * line that belongs to the outer note.
 */

// Marker columns: outer at 0, mid at `m`, inner at `i`; the link definition and
// the trailing word both at `p`. The reference line resolves `[r]` and cites
// all three notes in order, so fn1 = outer, fn2 = mid, fn3 = inner.
const sp = (n: number) => ' '.repeat(n)
const doc = (m: number, i: number, p: number) =>
  [
    '[^f]: outer',
    '',
    `${sp(m)}[^g]: mid`,
    '',
    `${sp(i)}[^h]: inner`,
    '',
    `${sp(p)}[r]: /url`,
    `${sp(p)}TAILWORD`,
    '',
    'x[^f] [^g] [^h] [t][r]',
  ].join('\n') + '\n'

const noteCount = (html: string) => (html.match(/<li id="fn\d+">/g) ?? []).length
const referenceResolves = (html: string) => /<a href="\/url">t<\/a>/.test(html)

// Which note holds the trailing word, read off the list item that contains it.
const tailWordNote = (html: string): 'outer' | 'mid' | 'inner' | 'document' => {
  const items = html.matchAll(/<li id="fn\d+">([\s\S]*?)<\/li>/g)
  for (const [, body] of items) {
    if (!body.includes('TAILWORD')) continue
    if (body.includes('outer')) return 'outer'
    if (body.includes('mid')) return 'mid'
    if (body.includes('inner')) return 'inner'
  }
  return 'document'
}

describe('a trailing line below the inner note column falls to the reachable note', () => {
  // The two rows the ruling pins as canonical (markup-carve/carve#1959): three
  // notes, the reference resolves, and the trailing line belongs to the outer
  // note.
  it('pins the first ruled row (mid at 3, inner at 4, payload at 2)', () => {
    const html = carveToHtml(doc(3, 4, 2))
    expect(noteCount(html)).toBe(3)
    expect(referenceResolves(html)).toBe(true)
    expect(tailWordNote(html)).toBe('outer')
  })

  it('pins the second ruled row (mid at 2, inner at 4, payload at 3)', () => {
    const html = carveToHtml(doc(2, 4, 3))
    expect(noteCount(html)).toBe(3)
    expect(referenceResolves(html)).toBe(true)
    expect(tailWordNote(html)).toBe('outer')
  })

  // The degenerate `i < m+2` cells this fix corrects: the payload reaches the
  // mid note's body column but not the inner note's, so the innermost note must
  // not claim it. Before the fix both landed in the inner note.
  it('does not over-reach to the inner note (mid 3, inner 4, payload 5)', () => {
    const html = carveToHtml(doc(3, 4, 5))
    expect(noteCount(html)).toBe(3)
    expect(tailWordNote(html)).toBe('outer')
  })

  it('does not over-reach to the inner note (mid 4, inner 5, payload 6)', () => {
    const html = carveToHtml(doc(4, 5, 6))
    expect(noteCount(html)).toBe(3)
    expect(tailWordNote(html)).toBe('outer')
  })

  // A payload that DOES reach the inner note's own content column still lands in
  // the inner note - the fix narrows the over-reach, it does not close the note.
  it('still places a line that reaches the inner note in it (mid 2, inner 4, payload 6)', () => {
    const html = carveToHtml(doc(2, 4, 6))
    expect(noteCount(html)).toBe(3)
    expect(tailWordNote(html)).toBe('inner')
  })
})

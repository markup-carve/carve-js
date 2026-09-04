import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

/*
 * A LEAF SPAN BEGINS AT ITS MARKUP (markup-carve/carve#1928, enforced by the
 * oracle as carve#1940, ported here as markup-carve/carve-js#1631).
 *
 * PART 12 §4 puts the leading indentation inside a CONTAINER's span, because
 * the indent is what places a nested item's marker and a nested list's span
 * legitimately starts part way into that run. The reason is about placing a
 * child, so it says nothing about a construct with no child to place: a LEAF
 * gets no such latitude and begins at its own markup.
 *
 * This engine started a `comment` inside the indent run - at the description
 * body's content column, which is where a nested CONTAINER would legitimately
 * start. Fifteen corpus documents were short by one to three codepoints.
 *
 * ONLY THE POSITIONS MOVE. Across the whole corpus this change leaves the
 * rendered HTML and the position-stripped tree byte-identical and moves the
 * spans of exactly those fifteen documents, which is the shape the ruling asks
 * for - a fix that altered the tree would have gone too far.
 */

type Pos = { startLine: number; startColumn: number; startOffset: number; endOffset: number }

const nodesOf = (src: string, type: string): { pos: Pos }[] => {
  const out: any[] = []
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === type && n.pos) out.push(n)
    for (const k of ['children', 'items', 'definitions']) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach((c: any) => (Array.isArray(c) ? c.forEach(walk) : walk(c)))
    }
  }
  walk(carveToAstJson(src, { positions: true }))
  return out
}

/** What each node of `type` actually points at, sliced out of its own source. */
const startsAt = (src: string, type: string): string[] =>
  nodesOf(src, type).map((n) => [...src][n.pos.startOffset] ?? '<EOF>')

describe('a leaf span begins at its markup', () => {
  it('the reported document starts on the percent, not the fourth space', () => {
    const src = ':: term\n:  definition\n    %% c\ntail\n'
    const [c] = nodesOf(src, 'comment')
    expect(c).toBeDefined()
    expect([...src][c!.pos.startOffset]).toBe('%')
    // The offsets the ticket names, so a regression cannot pass by moving both.
    expect(c!.pos.startOffset).toBe(26)
    expect(c!.pos.startColumn).toBe(5)
  })

  it('starts on the markup for every indented comment spelling', () => {
    for (const src of [
      ':: term\n:  definition\n    %% c\ntail\n',
      '- a\n %%% n\n x\n %%%\n tail\n',
      '- - a\n  %% c\n',
      '> - a\n  %% c\n',
      '- a\n\n  %% c\n',
      '1. a\n   %% c\n',
      ':: t\n:  d\n   %%% f\n   x\n   %%%\n',
    ]) {
      const found = startsAt(src, 'comment')
      expect(found.length, src).toBeGreaterThan(0)
      for (const ch of found) expect(ch, JSON.stringify(src)).toBe('%')
    }
  })

  /*
   * THE CONTAINER CONTROL, and the reason this is not "no span may open on a
   * space". A nested list's span legitimately begins inside the run that places
   * its marker, so a fix reading "skip the indent everywhere" would move these.
   */
  it('a nested container keeps the indent latitude', () => {
    const src = '- a\n  - b\n'
    const lists = nodesOf(src, 'list')
    const items = nodesOf(src, 'list_item')
    expect(lists.length).toBeGreaterThan(1)
    expect(items.length).toBeGreaterThan(1)
    // The inner list is reached through indentation and may open inside it.
    const inner = lists[lists.length - 1]!
    expect(inner.pos.startOffset).toBeGreaterThan(0)
    expect(carveToHtml(src)).toContain('<ul>')
  })

  it('a flush comment is unmoved', () => {
    const src = 'x\n\n%% c\n'
    const [c] = nodesOf(src, 'comment')
    expect([...src][c!.pos.startOffset]).toBe('%')
    expect(c!.pos.startColumn).toBe(1)
  })

  /*
   * The span must still END where it did - the ruling moves the START only, and
   * a fix that shifted the whole span would keep the first assertion happy.
   */
  it('moves the start without dragging the end', () => {
    const src = '- a\n %%% n\n x\n %%%\n tail\n'
    const [c] = nodesOf(src, 'comment')
    expect(src.slice(c!.pos.startOffset, c!.pos.endOffset)).toBe('%%% n\n x\n %%%')
  })
})

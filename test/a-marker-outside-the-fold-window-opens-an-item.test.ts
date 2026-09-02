import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// THE FOLD WINDOW (PART 9 §24 C3 / §11, markup-carve/carve-js#1598).
//
// A list marker written under an open item folds into that item's lead text
// only where it sits STRICTLY BETWEEN the item's base column and its content
// column. At the base column it starts a sibling, at or past the content column
// it nests, and in both of those it opens a real item - so a definition written
// on it is metadata, not text.
//
// The definition pre-pass used to ask column EQUALITY with the open item
// instead, which is neither edge of that window, so it was wrong in both
// directions. Every column below is measured against the executable spec at the
// pinned corpus revision (scripts/spec/layout.mjs into scripts/spec/html.mjs).
// ---------------------------------------------------------------------------

const doc = (lead: string, indent: number, marker: string): string =>
  `${lead}\n${' '.repeat(indent)}${marker}[t]: /t\n\n[go][t]\n`

describe('a list marker outside the fold window opens an item', () => {
  // `- lead` hands its body out at column 2, so column 1 is the whole window.
  it.each([
    [0, 'collect'],
    [1, 'text'],
    [2, 'collect'],
    [3, 'collect'],
    [6, 'collect'],
  ])('reads column %i under a two-column item as %s', (indent, answer) => {
    for (const marker of ['- ', '1. ']) {
      const html = carveToHtml(doc('- lead', indent, marker))
      expect(html.includes('href="/t"'), `${indent} ${marker}`).toBe(answer === 'collect')
      expect(html.includes('[t]: /t'), `${indent} ${marker}`).toBe(answer === 'text')
    }
  })

  // `1. lead` hands its body out at column 3, so the window is 1 and 2.
  it.each([
    [0, 'collect'],
    [1, 'text'],
    [2, 'text'],
    [3, 'collect'],
    [5, 'collect'],
  ])('reads column %i under a three-column item as %s', (indent, answer) => {
    for (const marker of ['- ', '1. ']) {
      const html = carveToHtml(doc('1. lead', indent, marker))
      expect(html.includes('href="/t"'), `${indent} ${marker}`).toBe(answer === 'collect')
      expect(html.includes('[t]: /t'), `${indent} ${marker}`).toBe(answer === 'text')
    }
  })

  // `-   lead` hands its body out at column 4: the window widens with it, and
  // the two rows in the middle are the ones column equality got backwards.
  it.each([
    [0, 'collect'],
    [1, 'text'],
    [2, 'text'],
    [3, 'text'],
    [4, 'collect'],
    [5, 'collect'],
  ])('reads column %i under a four-column item as %s', (indent, answer) => {
    for (const marker of ['- ', '1. ']) {
      const html = carveToHtml(doc('-   lead', indent, marker))
      expect(html.includes('href="/t"'), `${indent} ${marker}`).toBe(answer === 'collect')
      expect(html.includes('[t]: /t'), `${indent} ${marker}`).toBe(answer === 'text')
    }
  })

  // A SIBLING OF A DIFFERENT MARKER FAMILY. The block parser already ended the
  // list and opened a real `ol` here - it does that for ordinary text too - so
  // the definition on that line was metadata and nothing collected it. These
  // three rows were pinned the other way by markup-carve/carve-js#1597, which
  // could only make the line survive; this is the answer they were waiting for.
  it.each([
    ['an item lead', '- lead\n1. [t]: /t'],
    ['item continuation prose', '- lead\nmore\n1. [t]: /t'],
    ['an ordered sibling already open', '- lead\n1. x\n1. [t]: /t'],
    ['an ordered lead under a bullet', '1. lead\n- [t]: /t'],
    ['a task sibling', '1. lead\n- [ ] [t]: /t'],
  ])('collects on a sibling of a different family below %s', (_name, source) => {
    const html = carveToHtml(`${source}\n\n[go][t]\n`)

    expect(html).toContain('<a href="/t">go</a>')
    expect(html).not.toContain('[t]: /t')
  })

  it('matches the executable spec byte for byte on the reported document', () => {
    expect(carveToHtml('- lead\n1. [t]: /t\n\n[go][t]\n')).toBe(
      '<ul>\n  <li>lead</li>\n</ul>\n<ol>\n  <li></li>\n</ol>\n<p><a href="/t">go</a></p>',
    )
  })

  it('leaves a marker inside the window as the item\'s own text', () => {
    // The other direction, and the one column equality answered by accident: a
    // marker at column 2 under `-   lead` lands exactly on the open item's
    // content column while sitting INSIDE its window. It is lead text, so a
    // reference must not resolve against it - the page printing the line and
    // the link table holding it are the two halves the pass may not have at
    // once.
    expect(carveToHtml('-   lead\n  - [t]: /t\n\n[go][t]\n')).toBe(
      '<ul>\n  <li>lead\n- [t]: /t</li>\n</ul>\n<p>[go][t]</p>',
    )
    expect(carveToHtml('1. lead\n - [t]: /t\n\n[go][t]\n')).toBe(
      '<ol>\n  <li>lead\n- [t]: /t</li>\n</ol>\n<p>[go][t]</p>',
    )
  })

  it('leaves a lazy marker under a quoted item as the quote\'s text', () => {
    // A line that does not re-mark the quote never reaches the list inside it,
    // whatever column its marker sits at, so the window does not apply.
    const html = carveToHtml('> - lead\n- [t]: /t\n\n[go][t]\n')

    expect(html).toContain('[t]: /t')
    expect(html).not.toContain('href="/t"')
  })

  it('still folds a marker under a document-level paragraph', () => {
    // §10: no list marker interrupts a paragraph that no item owns. The window
    // is a rule about being INSIDE an item and does not reach this line.
    expect(carveToHtml('lead\n1. [t]: /t\n\n[go][t]\n')).toBe(
      '<p>lead\n1. [t]: /t</p>\n<p>[go][t]</p>',
    )
  })
})

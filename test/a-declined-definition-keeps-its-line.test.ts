import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'

// ---------------------------------------------------------------------------
// THE DECLINE AND THE REMOVAL HAVE TO AGREE (markup-carve/carve-js#1597).
//
// The definition pre-pass and the block parser read the same line separately,
// and the block parser strips a definition line because the pre-pass is meant
// to have collected it. Where the two disagree the line is collected by nobody
// and removed by someone, so the render loses text the author typed.
//
// PART 9R R1a rests its conservative fallback on the opposite promise - "what
// it does not lose is the line" - and markup-carve/carve#1883 makes it
// normative: an implementation may under-collect or refuse, but it may not
// return a document missing text the author typed. Every row here reads BOTH
// halves: the reference stays unresolved (licensed) and the line is on the page
// (required).
// ---------------------------------------------------------------------------

const claiming: CarveExtension = {
  name: 'claiming',
  matchBlock(lines, start) {
    const line = lines[start]
    if (!line || !line.startsWith('@@@ ')) return null

    return {
      node: { type: 'paragraph', children: [{ type: 'text', value: line.slice(4) }] },
      linesConsumed: 1,
    }
  },
}

/** Filler long enough to drain the lazy-probe byte budget before the candidate. */
const drain = (): string[] => {
  const lines = ['p'.repeat(200)]
  for (let i = 0; i < 60; i++) lines.push(`- [d${i}]: /${i}`)
  lines.push('')
  return lines
}

/** A run only the matcher can read as leaving no paragraph open. */
const consumed = (): string[] => Array.from({ length: 50 }, (_line, i) => `@@@ ${i}`)

describe('a definition the pre-pass declined keeps its line', () => {
  it('keeps the line where the probe could not afford to run', () => {
    // The reported document. The pre-pass has spent its budget, so it falls back
    // to the static reading, which cannot see that the matcher ate the line
    // above: it reads a paragraph as still open and collects nothing. The block
    // parser runs the matcher for real, finds no open paragraph, and opens a
    // genuine item - whose only line it then removed on the strength of a
    // collection that never happened, leaving an empty `<li>`.
    const source = [...drain(), ...consumed(), '- [target]: /target', '', '[go][target]'].join('\n')
    const html = carveToHtml(`${source}\n`, { extensions: [claiming] })

    expect(html).toContain('<li>[target]: /target</li>')
    // Under-collecting is the error the clause licenses, and it is still here.
    expect(html).toContain('<p>[go][target]</p>')
    expect(html).not.toContain('href="/target"')
  })

  it.each([
    ['a bullet marker', '- [target]: /target'],
    ['an ordered marker', '1. [target]: /target'],
    ['a task marker', '- [ ] [target]: /target'],
    ['two markers', '- - [target]: /target'],
    ['a quote behind a marker', '- > [target]: /target'],
  ])('keeps the line under %s below a consumed run', (_name, carrier) => {
    const source = [...drain(), ...consumed(), carrier, '', '[go][target]'].join('\n')
    const html = carveToHtml(`${source}\n`, { extensions: [claiming] })

    expect(html).toContain('[target]: /target')
    expect(html).not.toContain('href="/target"')
  })

  // NO EXTENSION AND NO BUDGET IN SIGHT. The issue called the shape narrow -
  // "an extension matcher consumed the line above AND the probe that would have
  // seen it did not run" - and the sweep for neighbouring paths found it wider
  // than that. A sibling marker of a DIFFERENT family disagrees on its own: the
  // pre-pass reads `1.` under a `-` item as lazy paragraph text and collects
  // nothing, while the block parser ends the list and opens a real `<ol>` whose
  // line it strips. Two authored lines are enough.
  it.each([
    ['an item lead', '- lead\n1. [target]: /target'],
    ['item continuation prose', '- lead\nmore\n1. [target]: /target'],
    ['an ordered sibling already open', '- lead\n1. x\n1. [target]: /target'],
  ])('keeps the line on a sibling ordered marker below %s', (_name, source) => {
    const html = carveToHtml(`${source}\n\n[go][target]\n`)

    expect(html).toContain('[target]: /target')
    expect(html).not.toContain('href="/target"')
  })

  it('leaves no empty item behind where nothing collected the line', () => {
    // The render shape the bug produced, stated once as its own row: an item the
    // marker opened, emptied by a layer that believed the other layer had taken
    // its only line.
    expect(carveToHtml('- lead\n1. [target]: /target\n')).not.toMatch(/<li>\s*<\/li>/)
  })
})

import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { markdownToCarve } from '../src/markdown-migrate.js'

/**
 * A bracket pair cmark-gfm read as text imports as text, on both sides of the
 * disagreement (carve-js#2047, carve-js#2048).
 *
 * carve#2187 designates cmark-gfm 0.29.0.gfm.13 the reader the importers answer
 * to, and carve-php#2366 ruled that the designation carries the tasklist
 * extension's own scope rule with it: an oracle you follow except where its
 * behavior looks odd is not an oracle. The extension takes a box off a line
 * carrying ONE container marker, a bullet, and off the three states ` `, `x`
 * and `X`. Carve's task item has neither restriction, so two families of
 * position diverged:
 *
 * - out of the extension's reach - a second container marker on the line, a
 *   quote's or another item's - where carve-js read a box GFM had none of;
 * - the four Carve-only states `[-]`, `[_]`, `[>]` and `[?]`, which diverge at
 *   every position including the top level.
 *
 * Every reading below was measured against cmark-gfm 0.29.0.gfm.13 through
 * `gfm-wasm`, reached by `scripts/lib/markdown-oracle.mjs` in the spec repo.
 * Not `commonmark` 0.31.2, which has no tasklist extension and therefore
 * abstains: naming it has falsified two ticket premises in this family.
 *
 * The rendered HTML is asserted beside the Carve throughout, because a pair
 * kept as text and a checkbox are hard to tell apart in the Carve and
 * unmistakable in the render.
 */

const BOX = '<input type="checkbox"'
const STATES = [' ', 'x', 'X'] as const
const CARVE_ONLY = ['-', '_', '>', '?'] as const

/** The imported Carve and what it renders. */
const imported = (markdown: string): { carve: string; html: string } => {
  const carve = markdownToCarve(markdown)
  return { carve, html: carveToHtml(carve) }
}

describe('a task pair outside GFM’s reach imports as text', () => {
  it('keeps the ticket case as text', () => {
    const out = imported('> - [ ] foo\n')
    expect(out.carve).toBe('> - \\[ ] foo\n')
    expect(out.html).not.toContain(BOX)
    expect(out.html).toContain('<li>[ ] foo</li>')
  })

  // Each of these lines carries a second container marker before the bullet, so
  // the extension does not reach the list. Indentation alone never does that,
  // which is what the controls below hold.
  const outOfReach: Array<[string, string, string]> = [
    ['a quoted list', '> - ', '> - '],
    ['a twice-quoted list', '> > - ', '> > - '],
    ['a list a list item holds', '- - ', '- - '],
    ['a list an ordered item holds', '1. - ', '1. - '],
    ['three bullets on one line', '- - - ', '- - - '],
    ['a list a quoted item holds', '- > - ', '- > - '],
  ]

  it.each(outOfReach)('keeps the pair of %s as text', (_name, markdownLead, carveLead) => {
    for (const state of [...STATES, ...CARVE_ONLY]) {
      const out = imported(`${markdownLead}[${state}] foo\n`)
      expect(out.carve).toBe(`${carveLead}\\[${state}] foo\n`)
      expect(out.html).not.toContain(BOX)
      expect(out.html).toContain(`[${state === '>' ? '&gt;' : state}] foo`)
    }
  })

  it('keeps the pair of a sublist a quote holds as text', () => {
    // The sublist opens on a line of ITS OWN here, which is what puts the
    // unquoted form of the same shape in reach. The quote marker on the line is
    // the difference, and reading it as a nesting depth rather than as a marker
    // on the line got this one wrong.
    const out = imported('> - a\n>   - [ ] foo\n')
    expect(out.carve).toBe('> - a\n>   - \\[ ] foo\n')
    expect(out.html).not.toContain(BOX)
    expect(out.html).toContain('<li>[ ] foo</li>')
  })

  it.each(CARVE_ONLY)('keeps a top-level [%s] as text, the state GFM has none of', (state) => {
    const out = imported(`- [${state}] foo\n`)
    expect(out.carve).toBe(`- \\[${state}] foo\n`)
    expect(out.html).not.toContain(BOX)
    expect(out.html).not.toContain('data-task-state')
  })

  it('leaves an ordered task item alone, where an escape would guard nothing', () => {
    // `task_marker` in `resources/spec/03-blocks-core.ebnf` hangs off
    // `unordered_item` alone, so Carve reads no box behind `1.` to begin with.
    // cmark-gfm does read one; that loss is carve-js#2053's question and not a
    // reason to write a backslash here.
    const out = imported('1. [x] done\n')
    expect(out.carve).toBe('1. [x] done\n')
    expect(out.html).not.toContain(BOX)
  })

  describe('the controls, which hold on both sides of the change', () => {
    // Without these a change that simply stopped reading checkboxes passes
    // every case above.
    it.each(STATES)('still imports a top-level [%s] as a checkbox', (state) => {
      const out = imported(`- [${state}] foo\n`)
      expect(out.carve).toBe(`- [${state}] foo\n`)
      expect(out.html).toContain(BOX)
    })

    it('still imports a checkbox at a 3-space indent', () => {
      const out = imported('   - [ ] foo\n')
      expect(out.carve).toBe('- [ ] foo\n')
      expect(out.html).toContain(BOX)
    })

    it('still imports a checkbox in a sublist that opens on its own line', () => {
      // One marker on the line, so the extension reaches it however deep the
      // list is: `- - [ ] foo` has no box while this more deeply nested shape
      // does.
      const out = imported('- a\n  - [ ] foo\n')
      expect(out.carve).toBe('- a\n  - [ ] foo\n')
      expect(out.html).toContain(BOX)
      expect(imported('- a\n  - b\n    - [ ] foo\n').html).toContain(BOX)
    })

    it('leaves a quoted list with no bracket pair unchanged', () => {
      expect(imported('> - foo\n').carve).toBe('> - foo\n')
      expect(imported('> - a [ ] b\n').carve).toBe('> - a [ ] b\n')
      expect(imported('> - a [ ] b\n').html).not.toContain(BOX)
    })

    it('leaves a Carve-authored task item alone, this being an importer rule', () => {
      // `- [-] foo` written as Carve keeps its box: the parser's state set did
      // not change, only what a Markdown source is read to mean.
      expect(carveToHtml('- [-] foo\n')).toContain(BOX)
      expect(carveToHtml('> - [-] foo\n')).toContain(BOX)
    })

    it('leaves a pair inside code alone', () => {
      expect(imported('```\n- [-] foo\n> - [ ] bar\n```\n').carve).toBe('```\n- [-] foo\n> - [ ] bar\n```\n')
      expect(imported('a `> - [-] foo` b\n').carve).toBe('a `> - [-] foo` b\n')
      // Four columns in is indented code, which the importer writes as a fence.
      expect(imported('para\n\n    > - [-] foo\n').carve).toBe('para\n\n```\n> - [-] foo\n```\n')
    })

    it('leaves a pair GFM does not read at the item content either', () => {
      // No whitespace after the `]`, and no content after it: neither reader
      // sees a box, so there is nothing to keep as text.
      expect(imported('- [ ]foo\n').carve).toBe('- [ ]foo\n')
      expect(imported('- [ ]\n').carve).toBe('- [ ]\n')
    })
  })

  it('writes a fixed point of the formatter', () => {
    for (const markdown of [
      '> - [ ] foo\n',
      '- - [x] foo\n',
      '- [-] foo\n',
      '> - a\n>   - [?] foo\n',
      '1. - [ ] foo\n',
    ]) {
      const out = markdownToCarve(markdown)
      expect(carveToCarve(out)).toBe(out)
    }
  })
})

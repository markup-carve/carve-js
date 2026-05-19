import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Hard-wrap friendliness (README Design Principle 7): a hard-wrapped prose
 * line that happens to begin with an operator/marker (`* 3`, `- 3`, `> 5`,
 * `| x`) must NOT silently become a list/quote/table. A lone marker line in
 * flowing prose only starts a block when it forms a *real* block:
 *   - 2+ consecutive markers of the same kind, OR
 *   - an indented continuation (multi-line first item), OR
 *   - it is preceded by a blank line (then any single marker starts a block).
 * This mirrors djot-php #180.
 */
describe('paragraph interruption — lone marker is not a block', () => {
  it('multiplication "* 3" stays prose', () => {
    const html = carveToHtml('Die Frage ist x = 5\n* 3 + 17 wahr.\nim Text.')
    expect(html).not.toContain('<ul>')
    expect(html).not.toContain('<li>')
  })

  it('minus "- 3" stays prose', () => {
    const html = carveToHtml('Das Ergebnis von 10\n- 3 ist 7. kein Punkt.')
    expect(html).not.toContain('<ul>')
  })

  it('greater-than "> 5" stays prose', () => {
    const html = carveToHtml('Wenn x\n> 5 dann ist es wahr.')
    expect(html).not.toContain('<blockquote>')
  })

  it('lone pipe line does not start a table', () => {
    const html = carveToHtml('Das berechnet a\n| b als bitweises Oder.')
    expect(html).not.toContain('<table')
  })
})

describe('paragraph interruption — real blocks still interrupt', () => {
  it('2+ markers form a list', () => {
    const html = carveToHtml('Liste:\n- eins\n- zwei')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>eins</li>')
  })

  it('blank line then single marker is a list', () => {
    const html = carveToHtml('Text hier\n\n- nur eins')
    expect(html).toContain('<ul>')
  })

  it('single item with indented continuation is a list', () => {
    const html = carveToHtml('Shopping:\n- milk and\n  some bread')
    expect(html).toContain('<ul>')
  })

  it('2+ line blockquote still interrupts', () => {
    const html = carveToHtml('They said:\n> one\n> two')
    expect(html).toContain('<blockquote>')
  })

  it('heading still interrupts on a single line', () => {
    const html = carveToHtml('Some text\n# Heading')
    expect(html).toContain('<h1')
  })

  it('BC: a single bullet with no blank line is prose, not a 1-item list', () => {
    const html = carveToHtml('Preis:\n- 10 euro')
    expect(html).not.toContain('<ul>')
  })
})

// The guard is scoped to the document top level (Lexer.nested). Inside
// already-nested block content a single marker must still start a block —
// otherwise `- a\n  - b` regresses. (Codex review P1/P2.)
describe('guard is top-level only — nested content unaffected', () => {
  it('single nested child still nests', () => {
    const html = carveToHtml('- parent\n  - child')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>child</li>')
  })

  it('single bullet inside a blockquote still nests', () => {
    const html = carveToHtml('> intro\n> - child')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<li>child</li>')
  })

  it('lead text + single nested child in one item', () => {
    const html = carveToHtml('- parent text\n  - child')
    expect(html).toContain('<li>child</li>')
  })

  it('captioned one-line quote after prose is a figure', () => {
    const html = carveToHtml('Intro\n> Stay hungry\n^ Steve Jobs')
    expect(html).toContain('<figure>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<figcaption>Steve Jobs</figcaption>')
  })

  it('captioned one-row table after prose interrupts (table caption)', () => {
    const html = carveToHtml('Intro\n|= A |\n^ caption')
    expect(html).toContain('<p>Intro</p>')
    expect(html).toContain('<table>')
    expect(html).toContain('<caption>caption</caption>')
  })
})

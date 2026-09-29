import { describe, expect, it } from 'vitest'

import { carveToAnsi, carveToHtml, carveToMarkdown, carveToPlainText, listTable } from '../src/index.js'

/**
 * carve-js#2387. A grouping `[label]` on a `::: list-table` was dropped from the
 * HTML the extension emits. The floor in `docs/graceful-degradation.md`, "How
 * unused labels appear", requires an unconsumed label to render as a visible
 * caption, and `CARVE-P9-072` reads its trigger as consumption rather than
 * extension activity: it requires the same fallback "because no group extension
 * consumes it" for `glossary` and `index`, kinds whose own extension is running.
 * A list-table is not a group extension, so its label goes unconsumed.
 *
 * Placement follows the same clause: a `<table>` admits no `<p>`, and its one
 * `<caption>` slot belongs to the quoted title, so the tokens precede the
 * element. The non-HTML targets already carried the label; they are pinned here
 * so the loss cannot reappear on one target alone.
 */

const html = (s: string): string => carveToHtml(s, { extensions: [listTable()] }).trim()

const table = ['- - a', '  - b'].join('\n')

describe('an unconsumed list-table label renders ahead of the table', () => {
  it('renders the label before the generated table', () => {
    expect(html(`::: list-table [plain]\n${table}\n:::`)).toBe(
      [
        '<p class="div-label">plain</p>',
        '<table>',
        '  <tbody>',
        '    <tr><td>a</td><td>b</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('leaves the caption slot to the quoted title', () => {
    expect(html(`::: list-table "Cap" [plain]\n${table}\n:::`)).toBe(
      [
        '<p class="div-label">plain</p>',
        '<table>',
        '  <caption>Cap</caption>',
        '  <tbody>',
        '    <tr><td>a</td><td>b</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('renders the label through the inline pipeline', () => {
    expect(html(`::: list-table [/em/]\n${table}\n:::`)).toContain(
      '<p class="div-label"><em>em</em></p>',
    )
  })

  it('keeps the label outside a table that crosses a row group', () => {
    const src = ['{header-rows=1}', '::: list-table [g]', '- - A', '  - B', '- - ^', '  - y', ':::'].join('\n')
    const out = html(src)
    expect(out.startsWith('<p class="div-label">g</p>\n<table>')).toBe(true)
    expect(out).toContain('rowspan="2"')
  })

  it('indents the label with the table it precedes', () => {
    expect(html(`::: wrap\n\n::: list-table [inner]\n${table}\n:::\n\n:::`)).toBe(
      [
        '<div class="wrap">',
        '  <p class="div-label">inner</p>',
        '  <table>',
        '    <tbody>',
        '      <tr><td>a</td><td>b</td></tr>',
        '    </tbody>',
        '  </table>',
        '</div>',
      ].join('\n'),
    )
  })

  it('writes no floor for an empty grouping, as the sibling kinds and the other targets do not', () => {
    expect(html(`::: list-table []\n${table}\n:::`)).toBe(
      ['<table>', '  <tbody>', '    <tr><td>a</td><td>b</td></tr>', '  </tbody>', '</table>'].join('\n'),
    )
    expect(carveToMarkdown(`::: list-table []\n${table}\n:::\n`)).not.toContain('**')
  })

  it('renders the label once when the block degrades to the plain div', () => {
    const malformed = `::: list-table [plain]\n- not a cell row\n:::`
    const out = html(malformed)
    expect(out.match(/div-label/g)).toHaveLength(1)
    expect(out).toContain('<div class="list-table">')
  })

  it('keeps carrying the label on the Markdown, plain and ANSI targets', () => {
    const src = `::: list-table [plain]\n${table}\n:::\n`
    expect(carveToMarkdown(src, { extensions: [listTable()] })).toBe(
      '**plain**\n\n|  |  |\n| --- | --- |\n| a | b |\n',
    )
    expect(carveToPlainText(src, { extensions: [listTable()] })).toContain('plain\n')
    expect(carveToAnsi(src, { extensions: [listTable()] })).toContain('plain')
  })
})

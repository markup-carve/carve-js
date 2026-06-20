import { describe, expect, it } from 'vitest'

import { carveToHtml, listTable } from '../src/index.js'

/** Render with the list-table extension registered, trimmed for exact compare. */
const h = (s: string): string => carveToHtml(s, { extensions: [listTable()] }).trim()
/** Render WITHOUT the extension (default core renderer). */
const plain = (s: string): string => carveToHtml(s).trim()

describe('list-table Tier-3 extension', () => {
  it('renders a basic two-column table with header row and caption', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table "Quarterly results"',
      '- - Region',
      '  - Notes',
      '- - EMEA',
      '  - Strong quarter.',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <caption>Quarterly results</caption>',
        '  <thead><tr><th>Region</th><th>Notes</th></tr></thead>',
        '  <tbody>',
        '    <tr><td>EMEA</td><td>Strong quarter.</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('keeps a multi-block cell wrapped while a single paragraph collapses', () => {
    const src = [
      '::: list-table',
      '- - EMEA',
      '  - Strong quarter.',
      '',
      '    Drivers:',
      '',
      '    - new logos',
      '    - renewals',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td>EMEA</td><td><p>Strong quarter.</p>',
        '<p>Drivers:</p>',
        '<ul>',
        '  <li>new logos</li>',
        '  <li>renewals</li>',
        '</ul></td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('promotes the first N columns to row-header <th> with header-cols', () => {
    const src = [
      '{header-cols=1}',
      '::: list-table',
      '- - Region',
      '  - Revenue',
      '- - EMEA',
      '  - 1.2M',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><th>Region</th><td>Revenue</td></tr>',
        '    <tr><th>EMEA</th><td>1.2M</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('treats {header-rows} with no value as the first row (boolean form)', () => {
    const src = [
      '{header-rows}',
      '::: list-table',
      '- - Region',
      '  - Notes',
      '- - EMEA',
      '  - ok',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead><tr><th>Region</th><th>Notes</th></tr></thead>',
        '  <tbody>',
        '    <tr><td>EMEA</td><td>ok</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('treats {header-cols} with no value as the first column (boolean form)', () => {
    const src = [
      '{header-cols}',
      '::: list-table',
      '- - Region',
      '  - Notes',
      '- - EMEA',
      '  - ok',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><th>Region</th><td>Notes</td></tr>',
        '    <tr><th>EMEA</th><td>ok</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('combines header-rows and header-cols', () => {
    const src = [
      '{header-rows=1}',
      '{header-cols=1}',
      '::: list-table',
      '- - Metric',
      '  - Q1',
      '  - Q2',
      '- - EMEA',
      '  - 1.0',
      '  - 1.2',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead><tr><th>Metric</th><th>Q1</th><th>Q2</th></tr></thead>',
        '  <tbody>',
        '    <tr><th>EMEA</th><td>1.0</td><td>1.2</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('pads ragged rows with empty cells', () => {
    const src = [
      '::: list-table',
      '- - A',
      '  - B',
      '  - C',
      '- - D',
      '  - E',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td>A</td><td>B</td><td>C</td></tr>',
        '    <tr><td>D</td><td>E</td><td></td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('renders without a caption when no title is given', () => {
    const src = ['::: list-table', '- - A', '  - B', ':::'].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td>A</td><td>B</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('renders inline markup inside a cell', () => {
    const src = ['::: list-table', '- - Use `flat` markup', ':::'].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td>Use <code>flat</code> markup</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('escapes HTML-special characters in the caption', () => {
    const src = ['::: list-table "Tom & Jerry"', '- - A', ':::'].join('\n')
    expect(h(src)).toContain('<caption>Tom &amp; Jerry</caption>')
  })

  it('degrades to the default nested-list div when the extension is off', () => {
    const src = ['::: list-table', '- - A', '  - B', ':::'].join('\n')
    expect(plain(src)).toBe(
      [
        '<div class="list-table">',
        '  <ul>',
        '    <li>',
        '      <ul>',
        '        <li>A</li>',
        '        <li>B</li>',
        '      </ul>',
        '    </li>',
        '  </ul>',
        '</div>',
      ].join('\n'),
    )
  })

  it('does not claim other admonition types', () => {
    const src = ['::: note', 'Hello.', ':::'].join('\n')
    expect(h(src)).toBe(
      ['<aside class="admonition note">', '  <p>Hello.</p>', '</aside>'].join('\n'),
    )
  })

  it('defers a list-table with no list to the default renderer', () => {
    const src = ['::: list-table', 'Just a paragraph, no list.', ':::'].join('\n')
    expect(h(src)).toBe(
      ['<div class="list-table">', '  <p>Just a paragraph, no list.</p>', '</div>'].join('\n'),
    )
  })

  it('merges a lone ^ cell up into a rowspan', () => {
    const src = ['::: list-table', '- - A', '  - B', '- - ^', '  - C', ':::'].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td rowspan="2">A</td><td>B</td></tr>',
        '    <tr><td>C</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('merges a lone < cell left into a colspan', () => {
    const src = ['::: list-table', '- - A', '  - <', '- - C', '  - D', ':::'].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td colspan="2">A</td></tr>',
        '    <tr><td>C</td><td>D</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('grows a colspan across two < markers', () => {
    const src = [
      '::: list-table',
      '- - Total',
      '  - <',
      '  - <',
      '- - a',
      '  - b',
      '  - c',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td colspan="3">Total</td></tr>',
        '    <tr><td>a</td><td>b</td><td>c</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('combines rowspan and colspan to match a pipe table (Sales)', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table "Sales"',
      '- - Region',
      '  - Q1',
      '  - Q2',
      '- - EMEA',
      '  - 10',
      '  - 12',
      '- - ^',
      '  - 14',
      '  - 16',
      '- - Total',
      '  - <',
      '  - <',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <caption>Sales</caption>',
        '  <thead><tr><th>Region</th><th>Q1</th><th>Q2</th></tr></thead>',
        '  <tbody>',
        '    <tr><td rowspan="2">EMEA</td><td>10</td><td>12</td></tr>',
        '    <tr><td>14</td><td>16</td></tr>',
        '    <tr><td colspan="3">Total</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('matches the equivalent pipe table for the same spans (body only)', () => {
    const listSrc = [
      '{header-rows=1}',
      '::: list-table',
      '- - Region',
      '  - Q1',
      '  - Q2',
      '- - EMEA',
      '  - 10',
      '  - 12',
      '- - ^',
      '  - 14',
      '  - 16',
      '- - Total',
      '  - <',
      '  - <',
      ':::',
    ].join('\n')
    const pipe = [
      '| Region | Q1 | Q2 |',
      '|--------|----|----|',
      '| EMEA   | 10 | 12 |',
      '| ^      | 14 | 16 |',
      '| Total  | <  | <  |',
    ].join('\n')
    expect(h(listSrc)).toBe(plain(pipe))
  })

  it('does not let a header-row rowspan cross into the body (^ in body)', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table',
      '- - A',
      '  - B',
      '  - C',
      '- - ^',
      '  - E',
      '  - F',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>',
        '  <tbody>',
        '    <tr><td></td><td>E</td><td>F</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('clamps a rowspan under a header colspan body at the header boundary', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table',
      '- - A',
      '  - <',
      '  - C',
      '- - x',
      '  - ^',
      '  - y',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead><tr><th colspan="2">A</th><th>C</th></tr></thead>',
        '  <tbody>',
        '    <tr><td>x</td><td></td><td>y</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
    expect(h(src)).not.toContain('rowspan')
  })

  it('still produces a rowspan that stays within the body', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table',
      '- - H1',
      '  - H2',
      '- - A',
      '  - B',
      '- - ^',
      '  - C',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <thead><tr><th>H1</th><th>H2</th></tr></thead>',
        '  <tbody>',
        '    <tr><td rowspan="2">A</td><td>B</td></tr>',
        '    <tr><td>C</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
  })

  it('does not crash on overlapping span markers with a stale origin', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table',
      '- - A',
      '  - A',
      '  - <',
      '- - A',
      '  - A',
      '  - ^',
      '- - A',
      '  - ^',
      '  - A',
      ':::',
    ].join('\n')
    const html = h(src)
    expect(html.startsWith('<table>')).toBe(true)
    expect(html.endsWith('</table>')).toBe(true)
  })

  it('resolves overlapping span markers to the same span markup as a pipe table', () => {
    // A fuzz-found overlap: a `^` whose source cell was itself merged by a `<`.
    // The span resolution (rowspan/colspan attributes) must match the equivalent
    // carve-js pipe table exactly. Compared after stripping pure-empty padding
    // <td></td>/<th></th> cells - the list-table pads ragged/overlapping grids
    // rectangular while the pipe table leaves the browser to auto-flow, a layout
    // difference that does not affect the span markup itself.
    const rows = [
      ['A', '<', '<'],
      ['A', '<', '^'],
      ['^', 'A', 'A'],
    ]
    const listLines = ['::: list-table']
    for (const row of rows) {
      row.forEach((cell, i) => {
        listLines.push((i === 0 ? '- - ' : '  - ') + cell)
      })
    }
    listLines.push(':::')

    const pipeLines = rows.map((row) => '| ' + row.join(' | ') + ' |')
    const stripPad = (s: string): string => s.replace(/<(td|th)><\/\1>/g, '')
    expect(stripPad(h(listLines.join('\n')))).toBe(stripPad(plain(pipeLines.join('\n'))))
  })

  it('resolves a ^ below a ragged row with the positional span model', () => {
    // carve-js's span model is positional (per source column), matching its pipe
    // tables: a `^` extends the nearest non-skipped cell above in its column even
    // across a ragged gap, so B gains a rowspan. This deliberately differs from
    // carve-php, whose model requires column contiguity (no rowspan there). The
    // binding invariant is parity with the equivalent carve-js pipe table's
    // rowspan resolution; the trailing empty cell is list-table ragged padding.
    const src = [
      '::: list-table',
      '- - A',
      '  - B',
      '- - C',
      '- - X',
      '  - ^',
      ':::',
    ].join('\n')
    expect(h(src)).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td>A</td><td rowspan="2">B</td></tr>',
        '    <tr><td>C</td></tr>',
        '    <tr><td>X</td><td></td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
    // B's rowspan matches what the equivalent pipe table resolves for the markers.
    const pipe = ['| A | B |', '|---|---|', '| C |', '| X | ^ |'].join('\n')
    expect(plain(pipe)).toContain('rowspan="2"')
  })

  it('renders a ^ below a ragged gap as an empty cell, not a rowspan', () => {
    const src = ['::: list-table', '- - A', '- - B', '  - ^', ':::'].join('\n')
    expect(h(src)).not.toContain('rowspan')
  })

  it('treats an attributed cell as content, never a span marker (escape)', () => {
    const src = ['::: list-table', '- - -{.x} ^', '  - B', ':::'].join('\n')
    const html = h(src)
    expect(html).not.toContain('rowspan')
    expect(html).not.toContain('colspan')
    expect(html).toContain('^')
    expect(html).toContain('<td>B</td>')
  })

  it('defers a row with leading content before its cell list (no content lost)', () => {
    // A row whose item holds a block BEFORE its inner cell list (`- row intro`
    // then an indented `- A`) cannot become cells without dropping the leading
    // text. The whole block defers to the default renderer.
    const src = [
      '::: list-table',
      '- row intro',
      '  - A',
      '  - B',
      ':::',
    ].join('\n')
    const withExt = h(src)
    expect(withExt).toBe(plain(src))
    expect(withExt.startsWith('<div class="list-table">')).toBe(true)
    expect(withExt).toContain('row intro')
    expect(withExt).not.toContain('<table')
  })

  it('defers a row with no cell list and preserves its content', () => {
    const src = ['::: list-table', '- - A', '  - B', '- not-a-cell-row', ':::'].join('\n')
    const withExt = h(src)
    expect(withExt).toBe(plain(src))
    expect(withExt.startsWith('<div class="list-table">')).toBe(true)
    expect(withExt).toContain('not-a-cell-row')
    expect(withExt).not.toContain('<table')
  })

  it('renders a deferred malformed table identically to the plain div (no duplication)', () => {
    const src = [
      '::: list-table',
      '- - A',
      '  - B',
      '',
      '  stray block',
      '- not-a-cell-row',
      ':::',
    ].join('\n')
    const withExt = h(src)
    expect(withExt).toBe(plain(src))
    expect(withExt.split('stray block').length - 1).toBe(1)
  })

  it('does not let a header-row rowspan cross into the body (single ^)', () => {
    const src = [
      '{header-rows=1}',
      '::: list-table',
      '- - H1',
      '  - H2',
      '- - ^',
      '  - x',
      ':::',
    ].join('\n')
    const html = h(src)
    expect(html).toBe(
      [
        '<table>',
        '  <thead><tr><th>H1</th><th>H2</th></tr></thead>',
        '  <tbody>',
        '    <tr><td></td><td>x</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
    expect(html).not.toContain('rowspan')
  })

  it('treats a multi-block cell starting with a marker char as content', () => {
    const src = ['::: list-table', '- - A', '- - ^', '', '  extra', ':::'].join('\n')
    const html = h(src)
    expect(html).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td>A</td></tr>',
        '    <tr><td><p>^</p>',
        '<p>extra</p></td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
    expect(html).not.toContain('rowspan')
  })

  it('carries a cell’s own attributes onto its tag while the structural span wins', () => {
    // A cell attribute block abuts the inner marker (`-{...}`); the author
    // rowspan/colspan is dropped so the computed structural span is the only one.
    const src = [
      '::: list-table',
      '- -{.hi #a1 rowspan=99} A',
      '  - B',
      '- - ^',
      '  - C',
      ':::',
    ].join('\n')
    const html = h(src)
    expect(html).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr><td rowspan="2" class="hi" id="a1">A</td><td>B</td></tr>',
        '    <tr><td>C</td></tr>',
        '  </tbody>',
        '</table>',
      ].join('\n'),
    )
    // Exactly one rowspan attribute survives (the computed one).
    expect(html.split('rowspan').length - 1).toBe(1)
  })

  it('defers when stray sibling content surrounds the list (no content lost)', () => {
    const src = [
      '::: list-table',
      'Intro paragraph.',
      '',
      '- - A',
      '  - B',
      '',
      'Trailing paragraph.',
      ':::',
    ].join('\n')
    const html = h(src)
    expect(html.startsWith('<div class="list-table">')).toBe(true)
    expect(html).toContain('<p>Intro paragraph.</p>')
    expect(html).toContain('<p>Trailing paragraph.</p>')
    expect(html).toContain('<li>A</li>')
    expect(html).toContain('<li>B</li>')
    expect(html).not.toContain('<table')
  })
})

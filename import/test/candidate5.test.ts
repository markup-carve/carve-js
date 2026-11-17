// The importer entries of the fifth fix round (TODO_spec26 I1 to I13) and vertical alignment (C2-M-040).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Block, TableNode } from '../../v2/src/index.ts'
import { importDocument } from '../src/index.ts'

function imported(html: string): { children: Block[], source: string, codes: string[] } {
  const result = importDocument(html, { from: 'html' })
  return { children: result.document.children as Block[], source: result.source, codes: result.diagnostics.map(entry => entry.code) }
}

function table(html: string): TableNode {
  const node = imported(html).children[0]
  if (node?.type !== 'table') throw new Error('no table')
  return node
}

function firstCell(html: string): Record<string, unknown> {
  const group = table(html).children[0]
  if (group === undefined || group.type === 'comment') throw new Error('no group')
  const row = group.children[0]
  if (row?.type !== 'table_row') throw new Error('no row')
  return row.children[0] as unknown as Record<string, unknown>
}

describe('the HTML importer at freeze candidate 5', () => {
  it('C2-M-038, C2-A-091: a cell whose blocks are all dropped holds one empty cell paragraph (I1)', () => {
    for (const html of ['<table><tr><td><p></p></td><td>a</td></tr></table>', '<table><tr><td><ul></ul></td></tr></table>']) {
      expect(firstCell(html)['children'], html).toEqual([{ type: 'cell_paragraph', children: [] }])
      expect(imported(html).codes, html).toContain('import-structure-repaired')
    }
  })

  it('C2-M-037, C2-A-086: the first head is the first group and the first foot the last; a further one is a body (I2)', () => {
    const node = table('<table><thead><tr><th>h</th></tr></thead><tfoot><tr><td>f</td></tr></tfoot>'
      + '<tbody><tr><td>b</td></tr></tbody></table>')
    expect(node.children.map(group => group.type)).toEqual(['table_head', 'table_body', 'table_foot'])
    const html = '<table><thead><tr><th>h</th></tr></thead><thead><tr><th>i</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'
    expect(table(html).children.map(group => group.type)).toEqual(['table_head', 'table_body', 'table_body'])
    expect(imported(html).codes).toContain('import-structure-repaired')
  })

  it('C2-M-075: a text-align declaration wins over an align attribute, which is dropped (I3)', () => {
    const result = imported('<p align="right" style="text-align: left;">x</p>')
    expect(result.source).toBe('{align=left}\nx\n')
    expect(result.codes).toContain('import-attribute-dropped')
  })

  it('C2-M-035 row `ext`, C2-I-094: `ext-1` is an ordinary class, since `1` is no inline extension name (I4)', () => {
    expect(imported('<p><span class="ext-1">x</span></p>').source).toBe('[x]{.ext-1}\n')
    expect(imported('<p><span class="ext-a">x</span></p>').source).toBe(':a[x]\n')
  })

  it('C2-M-041, C2-B-212: a col style that gives no width is dropped and reported (I5)', () => {
    for (const style of ['width: 150%;', 'width: 0%;', 'color: red']) {
      const html = `<table><colgroup><col style="${style}"></colgroup><tr><td>a</td></tr></table>`
      expect(table(html).columns, style).toEqual([{ type: 'table_column' }])
      expect(imported(html).codes, style).toContain('import-attribute-dropped')
    }
    expect(table('<table><colgroup><col style="width: 30.5%;"></colgroup><tr><td>a</td></tr></table>').columns[0]?.width).toBe(0.305)
  })

  it('C2-M-040, C2-B-213: case-insensitive values; a value outside its set is dropped and reported (I6, Example 54)', () => {
    const html = '<table><tr><td ALIGN="CENTER" valign="center">a</td></tr></table>'
    expect(table(html).columns).toEqual([{ type: 'table_column', align: 'center' }])
    expect(imported(html).codes).toContain('import-attribute-dropped')
  })

  it('C2-M-043, C2-H-199: the attributes of a figure and of its block merge, the figure first (I7, Example 55)', () => {
    const html = '<figure class="wide" id="f"><table class="t" id="t"><tr><td>a</td></tr></table><figcaption>c</figcaption></figure>'
    const result = imported(html)
    expect(result.source).toBe('{#t .wide .t}\n| a |\n^ c\n')
    expect(result.codes).toContain('import-attribute-dropped')
  })

  it('C2-M-031, C2-B-045: a start below 1 on a list of letters is dropped and reported (I8)', () => {
    const result = imported('<ol type="a" start="0"><li>x</li></ol>')
    const list = result.children[0]
    expect(list?.type === 'list' ? list.marker : undefined).toEqual({ kind: 'ordered', style: 'a', delimiter: '.' })
    expect(result.codes).toContain('import-attribute-dropped')
    expect(result.codes).not.toContain('field-unspellable')
  })

  it('C2-M-052 row `class`, C2-A-058: a class of spaces only gives no `classes` (I9, Example 57)', () => {
    for (const html of ['<p class="  ">x</p>', '<p class="">x</p>']) expect(imported(html).children, html)
      .toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }])
  })

  it('C2-M-061: a footnote item whose key would be empty is dropped and reported (I10)', () => {
    const result = imported('<section class="footnotes"><ol><li id="fn"><p>n</p></li></ol></section>')
    expect(result.children.some(node => (node.type as string) === 'footnote')).toBe(false)
    expect(result.codes).toContain('import-structure-repaired')
  })

  it('C2-M-052 row `dir`, C2-M-004: a direction in any ASCII letter case is kept in lower case (I11)', () => {
    expect(imported('<p dir="RTL">x</p>').children[0]).toMatchObject({ dir: 'rtl' })
    expect(importDocument('<html><body dir="Auto"><p>x</p></body></html>', { from: 'html' }).document.dir).toBe('auto')
  })

  it('C2-M-006, C2-W-101: HTML past the reader limits fails on the command line with status 2 (I12)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'carve-import-'))
    const file = join(directory, 'deep.html')
    writeFileSync(file, `${'<div>'.repeat(3000)}x${'</div>'.repeat(3000)}`)
    const run = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), '--from', 'html', file], { encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr.startsWith('carve[import-input-invalid]:')).toBe(true)
  })

  it('C2-M-040: an alignment declaration wins over the align attribute of a cell, which is dropped (I13)', () => {
    const html = '<table><tr><td align="left" style="text-align: right;">a</td></tr></table>'
    expect(table(html).columns).toEqual([{ type: 'table_column', align: 'right' }])
    expect(imported(html).codes).toContain('import-attribute-dropped')
  })

  it('C2-M-040: vertical alignment from `valign` or the exact declaration, both axes as a render writes them (Example 58)', () => {
    const html = '<table><thead><tr><th style="text-align: right; vertical-align: top;">Qty</th>'
      + '<th valign="bottom">Note</th></tr></thead>'
      + '<tbody><tr><td style="text-align: right; vertical-align: top;">1</td>'
      + '<td style="vertical-align: middle;">a</td></tr></tbody></table>'
    expect(imported(html).source).toBe('|={>^} Qty |={?v} Note |\n| 1 |{?~} a |\n')
    const both = '<table><tr><td valign="top" style="vertical-align: bottom;">a</td></tr></table>'
    expect(table(both).columns).toEqual([{ type: 'table_column', valign: 'bottom' }])
    expect(imported(both).codes).toContain('import-attribute-dropped')
    expect(firstCell('<table><tr><td style="vertical-align: baseline;">a</td></tr></table>')['valign']).toBe('baseline')
  })

  it('C2-M-002: a fragment is parsed with a body context, so a table row outside a table is its text', () => {
    expect(imported('<tr><td>a</td></tr>').source).toBe('a\n')
    expect(imported('<td>a</td> b').source).toBe('a b\n')
  })

  it('C2-M-016, C2-M-052 row `class`: a vertical tab is no ASCII whitespace, so it splits no class', () => {
    expect(imported('<p class="a\u000bb c">x</p>').children[0]).toMatchObject({ attrs: { classes: ['a\u000bb', 'c'] } })
  })

  it('C2-M-060: an aside that is no admonition is a div', () => {
    const result = imported('<aside class="note"><p>a</p></aside>')
    expect(result.children[0]).toEqual({ type: 'div', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }],
      attrs: { classes: ['note'] } })
    expect(result.codes).not.toContain('import-element-mapped')
  })
})

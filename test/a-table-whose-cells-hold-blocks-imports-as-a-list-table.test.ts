import { describe, expect, it } from 'vitest'
import { run, type CliIO } from '../src/cli.js'
import { carveToCarve, carveToMarkdown, htmlToAst, htmlToCarve, toAstJson } from '../src/index.js'

// docs/html-import-contract.md in the spec, "A table whose cells hold blocks
// can be written as a list table" (markup-carve/carve#2391).
const on = { listTableForBlockCells: true }

const steps = [
  '<table>',
  '<caption>Steps</caption>',
  '<tr><th>Step</th><th>Detail</th></tr>',
  '<tr><th>1</th><td><p>Install.</p><pre><code>npm i</code></pre></td></tr>',
  '<tr><td colspan="2">^</td></tr>',
  '</table>',
].join('\n')

const stepsCarve = [
  '{header-rows=1}',
  '::: list-table "Steps"',
  '- - Step',
  '  - Detail',
  '- -{header} 1',
  '',
  '  - Install.',
  '',
  '    ```',
  '    npm i',
  '    ```',
  '- - \\^',
  '  - <',
  ':::',
  '',
].join('\n')

describe('the list-table import option', () => {
  it('writes the contract example, a canonical fixed point', () => {
    const result = htmlToCarve(steps, on)
    expect(result.value).toBe(stepsCarve)
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(result.report.diagnostics).toEqual([])
  })

  it('is off by default, where the table keeps the pipe form', () => {
    expect(htmlToCarve(steps).value).toBe(
      ['|= Step |= Detail |', '|= 1 | Install. `npm i` |', '| \\^ | < |', '^ Steps', ''].join('\n'),
    )
  })

  it('leaves a table whose cells are all inline in the pipe form', () => {
    const html = '<table><tr><th>A</th></tr><tr><td><p>x</p></td></tr></table>'
    expect(htmlToCarve(html, on).value).toBe(htmlToCarve(html).value)
  })

  it('counts header columns over the grid and keeps a blank row', () => {
    const html = [
      '<table>',
      '<tr><th>H</th><th>I</th></tr>',
      '<tr><th rowspan="2">R</th><td><ul><li>a</li></ul></td></tr>',
      '<tr><td>b</td></tr>',
      '<tr><th></th><td></td></tr>',
      '</table>',
    ].join('')
    expect(htmlToCarve(html, on).value).toBe(
      [
        '{header-rows=1 header-cols=1}',
        '::: list-table',
        '- - H',
        '  - I',
        '- - R',
        '  - - a',
        '- - ^',
        '  - b',
        '- - +',
        '  - +',
        ':::',
        '',
      ].join('\n'),
    )
  })

  it('keeps cell attributes on the item and drops row attributes with a row', () => {
    const html = '<table id="t"><tr id="r"><td class="k"><p>a</p><p>b</p></td></tr></table>'
    const result = htmlToCarve(html, on)
    expect(result.value).toBe('{#t}\n::: list-table\n- -{.k} a\n\n    b\n:::\n')
    expect(result.report.diagnostics.map(({ code, severity, path }) => ({ code, severity, path }))).toEqual([
      { code: 'attribute-dropped', severity: 'info', path: '/table[1]/tr[1]' },
    ])
  })

  it('drops a row with no cells, and says so', () => {
    const result = htmlToCarve('<table><tr></tr><tr><th>H</th></tr><tr><td><p>a</p><p>b</p></td></tr></table>', on)
    expect(result.value).toBe('{header-rows=1}\n::: list-table\n- - H\n- - a\n\n    b\n:::\n')
    expect(result.report.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'structure-unspellable', path: '/table[1]/tr[1]' },
    ])
  })

  it('reports the lost row grouping on the AST exit too', () => {
    const html = '<table><tbody id="b"><tr><td><p>a</p><p>b</p></td></tr></tbody></table>'
    const codes = (report: { diagnostics: Array<{ code: string }> }): string[] => report.diagnostics.map((d) => d.code)
    expect(codes(htmlToAst(html, on).report)).toEqual(codes(htmlToCarve(html, on).report))
    expect(codes(htmlToAst(html, on).report)).toContain('structure-unspellable')
  })

  it('publishes the admonition on the AST exit too, with the cell text unescaped', () => {
    const [block] = toAstJson(htmlToAst(steps, on).value).children
    expect(block).toMatchObject({ type: 'admonition', kind: 'list-table', attrs: { keyValues: { 'header-rows': '1' } } })
    expect(JSON.stringify(block)).not.toContain('escaped_text')
    expect(JSON.stringify(block)).not.toContain('"order"')
  })

  it('is spelled --list-table on the CLI', async () => {
    let out = ''
    const io: CliIO = {
      readStdin: async () => steps,
      write: (s) => {
        out += s
      },
      writeErr: () => {},
      readFile: () => {
        throw new Error('no file')
      },
      writeFile: () => {},
    }
    expect(await run(['migrate', '--from', 'html', '--list-table'], io)).toBe(0)
    expect(out).toBe(stepsCarve)
  })
})

describe('the Markdown target writes a list table as a pipe table (CARVE-P11-059)', () => {
  it('flattens block cells and writes spans as the pipe writer does', () => {
    expect(carveToMarkdown(stepsCarve)).toBe(
      ['| Step | Detail |', '| --- | --- |', '| 1 | Install. npm i |', '| ^ |  |', '', 'Steps', ''].join('\n'),
    )
  })

  it('reads header-cols, a cell header and the positional aligns', () => {
    const source = ['{aligns="right" header-cols=1}', '::: list-table', '- - a', '  -{header} b', ':::', ''].join('\n')
    expect(carveToMarkdown(source)).toBe('| a | b |\n| ---: | --- |\n')
  })

  it('takes cells from every list in a row and keeps the label', () => {
    const source = '::: list-table [Lbl]\n- - a\n  - b\n\n  1. c\n  2. d\n:::\n'
    expect(carveToMarkdown(source)).toBe('**Lbl**\n\n|  |  |  |  |\n| --- | --- | --- | --- |\n| a | b | c | d |\n')
  })

  it('keeps the old writing for a body that is not a grid', () => {
    const source = '::: list-table "T"\n- one\n- two\n:::\n'
    expect(carveToMarkdown(source)).toBe('**T**\n\n- one\n- two\n')
  })
})

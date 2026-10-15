import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  carveToAnsiWithReport, carveToCarveWithReport, carveToHtmlWithReport,
  carveToMarkdownWithReport, carveToPlainTextWithReport, renderMarkdownWithReport,
} from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

const schema = JSON.parse(readFileSync(new URL('../spec/resources/render-loss-report.schema.json', import.meta.url), 'utf8'))
const HOISTED = 'Moved a header row above earlier body rows'
const CELL = 'Wrote a header cell as a body cell'

const hoisted = '| A | B |\n|= C |= D |\n'
const partial = '| A |= B |\n| C | D |\n'
const headerFirst = '|= A |= B |\n| C | D |\n'

const strip = (losses: readonly object[]) => losses.map(({ pos: _pos, ...loss }: { pos?: unknown }) => loss)

function cli(stdin: string) {
  let out = ''
  let err = ''
  const io: CliIO = {
    readStdin: async () => stdin,
    write: (s) => { out += s },
    writeErr: (s) => { err += s },
    readFile: (p) => { throw new Error(`ENOENT: ${p}`) },
    writeFile: () => {},
  }
  return { io, out: () => out, err: () => err }
}

describe('markup-carve/carve-js#3144: header roles the Markdown writer moves or drops', () => {
  it('reports a header row written above the body rows before it, and keeps CARVE-P11-031', () => {
    const result = carveToMarkdownWithReport(hoisted)
    expect(result.value).toBe('| C | D |\n| --- | --- |\n| A | B |\n')
    expect(strip(result.losses)).toEqual([
      { code: 'table-header-row-hoisted', target: 'markdown', nodeType: 'block', message: HOISTED },
    ])
    expect(result.losses[0]?.pos?.startLine).toBe(2)
  })

  it('reports each header cell of a partly-header row', () => {
    const result = carveToMarkdownWithReport('| A |= B |= E |\n| C | D | F |\n')
    expect(strip(result.losses)).toEqual([
      { code: 'table-header-cell-demoted', target: 'markdown', nodeType: 'block', message: CELL },
      { code: 'table-header-cell-demoted', target: 'markdown', nodeType: 'block', message: CELL },
    ])
    expect(result.losses.map(loss => loss.pos?.startColumn)).toEqual([6, 11])
    expect(strip(carveToMarkdownWithReport(partial).losses)).toHaveLength(1)
  })

  it('reports a header cell in a row below the header row', () => {
    expect(carveToMarkdownWithReport('|= A |= B |\n|= C | D |\n').losses.map(loss => loss.code)).toEqual(['table-header-cell-demoted'])
  })

  it('reports no loss for a table whose header row comes first', () => {
    expect(carveToMarkdownWithReport(headerFirst).losses).toEqual([])
    expect(carveToMarkdownWithReport('| A | B |\n| C | D |\n').losses).toEqual([])
  })

  it('reports nothing on the targets that keep header roles or have no header row', () => {
    for (const render of [carveToHtmlWithReport, carveToCarveWithReport, carveToPlainTextWithReport, carveToAnsiWithReport]) {
      expect(render(hoisted).losses).toEqual([])
      expect(render(partial).losses).toEqual([])
    }
  })

  it('orders a cell\'s demotion before its span loss and a row\'s loss before its cells\'', () => {
    const ast = {
      type: 'document', children: [{ type: 'table', rows: [
        { type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [{ type: 'text', value: 'A' }] }] },
        { type: 'table_row', cells: [
          { type: 'table_cell', header: true, children: [{ type: 'text', value: 'B' }] },
          { type: 'table_cell', header: false, span: 'colspan', children: [] },
        ] },
        { type: 'table_row', cells: [
          { type: 'table_cell', header: true, children: [{ type: 'text', value: 'C' }] },
          { type: 'table_cell', header: false, children: [{ type: 'text', value: 'D' }] },
        ] },
      ] }],
    } as Parameters<typeof renderMarkdownWithReport>[0]
    expect(renderMarkdownWithReport(ast).losses.map(loss => loss.code)).toEqual([
      'table-header-row-hoisted', 'table-span-flattened', 'table-header-cell-demoted',
    ])
  })

  it('writes both rows in the shape the pinned report schema names', () => {
    const branches = schema.properties.losses.items.oneOf as Array<{ properties: Record<string, { const?: string } | false> }>
    for (const loss of [...carveToMarkdownWithReport(hoisted).losses, ...carveToMarkdownWithReport(partial).losses]) {
      const branch = branches.find(rule => (rule.properties.code as { const: string }).const === loss.code)
      expect(branch, loss.code).toBeDefined()
      expect(loss.message).toBe((branch!.properties.message as { const: string }).const)
      for (const field of Object.keys(loss)) expect(branch!.properties[field], `${loss.code}.${field}`).not.toBe(false)
    }
  })

  it('fails --strict-losses on both codes unless each is allowed', async () => {
    for (const [source, code] of [[hoisted, 'table-header-row-hoisted'], [partial, 'table-header-cell-demoted']] as const) {
      const strict = cli(source)
      expect(await run(['render', '--markdown', '--strict-losses'], strict.io), code).toBe(1)
      expect(strict.out()).toBe('')
      expect(strict.err()).toContain(code)
      const allowed = cli(source)
      expect(await run(['render', '--markdown', '--strict-losses', '--allow-loss', code], allowed.io), code).toBe(0)
      expect(allowed.out()).not.toBe('')
    }
    const control = cli(headerFirst)
    expect(await run(['render', '--markdown', '--strict-losses'], control.io)).toBe(0)
  })
})

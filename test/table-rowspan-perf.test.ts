import { describe, it, expect } from 'vitest'
import { carveToHtml, htmlToAst } from '../src/index.js'
import { parse } from '../src/parse.js'
import { renderHtml } from '../src/render-html.js'
import { resolveTableSpans } from '../src/table-spans.js'
import type { TableRow } from '../src/ast.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// Regression guard for the O(rows^2) rowspan resolution. The renderer walked up
// every prior row per `^` marker to find its origin; a tall all-`^` table was
// quadratic (16k rows ~2.8s). The fix carries the nearest-non-skipped row per
// column, so each `^` resolves in O(1). Output must stay identical.
describe('table rowspan resolution (perf)', () => {
  it('spans the header cells over every following ^ row', () => {
    // The correctness half, at a size the everyday suite can afford.
    const rows = 2000
    const html = carveToHtml('|= a |= b |\n' + '| ^ | ^ |\n'.repeat(rows))

    expect(html).toContain(`rowspan="${rows + 1}"`)
  })

  perfIt('resolves a tall all-^ table in linear time', () => {
    expectScansLinearly((input) => void carveToHtml('|= a |= b |\n' + input), '| ^ | ^ |\n', {
      label: 'tall all-^ table',
      smallRepeats: 4000,
    })
  })
})

perfIt('imports 4000 empty bodies without repeated DOM searches', () => {
  const html = `<table>${'<tbody></tbody>'.repeat(4000)}</table>`
  const start = performance.now()
  htmlToAst(html)
  expect(performance.now() - start).toBeLessThan(2000)
})

function mergedRows(width: number): TableRow[] {
  return [undefined, 'rowspan' as const].map((span) => ({
    type: 'table_row',
    cells: Array.from({ length: width }, (_, c) => ({
      type: 'table_cell', header: false, children: [],
      ...(span ? { span } : c === 0 ? {} : { span: 'colspan' as const }),
    })),
  }))
}

it('resolves a wide colspan and the carets beneath every covered column', () => {
  const grid = resolveTableSpans(mergedRows(8000))
  expect(grid[0]![0]).toMatchObject({ colspan: 8000, rowspan: 2, skip: false })
  expect(grid[0]!.slice(1).every((cell) => cell.skip)).toBe(true)
  expect(grid[1]!.every((cell) => cell.skip)).toBe(true)
})

perfIt('resolves wide colspans and covered carets in linear time', () => {
  const rows = new Map([8000, 32000].map((width) => [width, mergedRows(width)]))
  expectScansLinearly((input) => void resolveTableSpans(rows.get(input.length)!), 'x', {
    label: 'wide merged rows', smallRepeats: 8000,
  })
})

function groupedDocument(count: number) {
  const doc = parse('| A |\n| ^ |\n'.repeat(count))
  const table = doc.children[0]!
  if (table.type !== 'table') throw new Error('expected table')
  table.rowGroups = {
    headRows: 0, footRows: 0,
    bodies: Array.from({ length: count }, () => ({
      headRows: 0, bodyRows: 2, attrs: { classes: ['group'] },
    })),
  }
  return doc
}

it('keeps independent spans inside their attributed row groups', () => {
  const html = renderHtml(groupedDocument(200))
  expect(html.match(/<tbody class="group">/g)).toHaveLength(200)
  expect(html.match(/rowspan="2"/g)).toHaveLength(200)
})

perfIt('renders many attributed row groups in linear time', () => {
  const docs = new Map([1000, 4000].map((count) => [count, groupedDocument(count)]))
  expectScansLinearly((input) => void renderHtml(docs.get(input.length)!), 'x', {
    label: 'many attributed groups with independent rowspans', smallRepeats: 1000,
  })
})

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  fromAstJson, resolve, renderCarve, renderMarkdown, renderPlainText, renderAnsi, renderHtml,
} from '../src/index.js'
import type { RenderLoss } from '../src/render-loss.js'
import { renderCarveWithConversionReport } from '../src/conversion-diagnostics.js'

/**
 * `CARVE-P2-024`'s `code` enum is CLOSED at `raw-format-dropped` and
 * `ruby-flattened` (PART 11 §1d, carve#2252 restored by carve#2344), and each
 * names a whole node one selected renderer dropped. A dropped FIELD, and a
 * structure no Carve source spells, go to the conversion-diagnostics channel
 * instead: `CARVE-P12-034` (table section attributes), `CARVE-P12-049`
 * (`table_cell.blocks`), `CARVE-P12-051` (`math.label`, `math.number`) and
 * `CARVE-P12-052` (`section`) each say so, and three of them say outright that
 * it is NOT a render loss.
 *
 * THE BAR IS THE PUBLISHED SCHEMA, NOT THIS FILE'S LIST: the permitted codes are
 * read out of the pinned `render-loss-report.schema.json`.
 */
const schemaCodes = (): string[] => JSON.parse(
  readFileSync(new URL('../spec/resources/render-loss-report.schema.json', import.meta.url), 'utf8'),
).properties.losses.items.properties.code.enum

/** Every §1d shape at once: a section, a block cell, a labelled equation and an attributed partition. */
const interchangeOnly = () => ({
  type: 'document',
  srcByteLength: 0,
  children: [
    {
      type: 'section',
      level: 1,
      children: [
        { type: 'paragraph', children: [{ type: 'math', display: true, content: 'x', label: 'eq:one', number: 1 }] },
        {
          type: 'table',
          rows: [{ type: 'table_row', cells: [{ type: 'table_cell', header: false, blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'cell' }] }] }] }],
          rowGroups: {
            headRows: 0,
            footRows: 0,
            headAttrs: { id: 'head' },
            footAttrs: { classes: ['foot'] },
            bodies: [{ headRows: 0, bodyRows: 1, attrs: { id: 'body' } }],
          },
        },
      ],
    },
  ],
})

/** A raw block and a ruby: the two losses the enum does name. */
const namedLosses = () => ({
  type: 'document',
  srcByteLength: 0,
  children: [
    { type: 'raw_block', format: 'html', content: '<b>x</b>' },
    { type: 'paragraph', children: [{ type: 'ruby', pairs: [{ base: [{ type: 'text', value: 'a' }], annotation: [{ type: 'text', value: 'b' }] }] }] },
  ],
})

const collect = (render: (ast: never, opts: never) => string, wire: unknown): RenderLoss[] => {
  const losses: RenderLoss[] = []
  render(resolve(fromAstJson(wire as never)) as never, { onRenderLoss: (loss: RenderLoss) => losses.push(loss) } as never)
  return losses
}

const targets = { carve: renderCarve, markdown: renderMarkdown, plain: renderPlainText, ansi: renderAnsi, html: renderHtml }

describe('the render-loss code enum', () => {
  it('is still closed at two codes in the pinned schema', () => {
    expect(schemaCodes()).toEqual(['raw-format-dropped', 'ruby-flattened'])
  })

  it('names no interchange-only shape on any target', () => {
    for (const [target, render] of Object.entries(targets)) {
      expect(collect(render as never, interchangeOnly()), target).toEqual([])
    }
  })

  it('emits only codes the schema permits, and emits both of them', () => {
    const seen = new Set<string>()
    for (const [target, render] of Object.entries(targets)) {
      for (const loss of [...collect(render as never, interchangeOnly()), ...collect(render as never, namedLosses())]) {
        expect(schemaCodes(), `${target} emitted ${loss.code}`).toContain(loss.code)
        seen.add(loss.code)
      }
    }
    expect([...seen].sort()).toEqual(schemaCodes())
  })

  it('reports every one of those shapes on the conversion-diagnostics channel', () => {
    const { report } = renderCarveWithConversionReport(resolve(fromAstJson(interchangeOnly() as never)) as never, renderCarve as never)
    expect(report.diagnostics.filter(d => d.code === 'structure-unspellable').map(d => d.node)).toContain('section')
    expect(report.diagnostics.filter(d => d.code === 'field-unspellable').map(d => `${d.node}.${d.field}`).sort()).toEqual([
      'math.label',
      'math.number',
      'table.rowGroups.bodies[0].attrs',
      'table.rowGroups.footAttrs',
      'table.rowGroups.headAttrs',
      'table_cell.blocks',
    ])
  })
})

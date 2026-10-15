import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  carveToMarkdownWithReport, fromAstJson, resolve, renderCarve, renderMarkdown, renderPlainText, renderAnsi, renderHtml,
} from '../src/index.js'
import type { RenderLoss } from '../src/render-loss.js'
import { renderCarveWithConversionReport } from '../src/conversion-diagnostics.js'

/**
 * `CARVE-P2-024`'s `code` enum holds `raw-format-dropped`, `ruby-flattened`,
 * `destination-denied`, `editorial-comment-flattened`, `carrier-attribute-dropped`,
 * `list-style-dropped`, `list-delimiter-changed`, `table-span-flattened`,
 * `table-header-row-demoted`, `table-header-row-hoisted` and
 * `table-header-cell-demoted`
 * (PART 11 §1d and PART 10 §13a). Each names something one selected renderer dropped
 * or blanked. A dropped FIELD, and a structure no Carve source spells, go to
 * the conversion-diagnostics channel
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
/**
 * The pinned schema's `losses.items` rules a record must meet: no field outside
 * `properties` (`additionalProperties: false`), the common `required` fields,
 * and the `oneOf` branch for its code (its `required`, `const`, `enum` and
 * forbidden `false` fields). Enough of JSON Schema for this one flat object.
 */
const schemaViolations = (loss: Record<string, unknown>): string[] => {
  type Rule = { const?: unknown; enum?: unknown[] } | false
  type Branch = { properties: Record<string, Rule>; required?: string[] }
  const item = JSON.parse(
    readFileSync(new URL('../spec/resources/render-loss-report.schema.json', import.meta.url), 'utf8'),
  ).properties.losses.items as { properties: Record<string, Rule>; required: string[]; oneOf: Branch[] }
  const out: string[] = []
  for (const key of Object.keys(loss)) if (!(key in item.properties)) out.push(`unknown field ${key}`)
  for (const key of item.required) if (!(key in loss)) out.push(`missing ${key}`)
  const matching = item.oneOf.filter((b) => (b.properties.code as { const?: unknown }).const === loss.code)
  if (matching.length !== 1) return [...out, `no single branch for ${String(loss.code)}`]
  const branch = matching[0]!
  for (const key of branch.required ?? []) if (!(key in loss)) out.push(`missing ${key}`)
  for (const [key, rule] of Object.entries({ ...item.properties, ...branch.properties })) {
    if (!(key in loss)) continue
    if (rule === false) out.push(`forbidden ${key}`)
    else if ('const' in rule && rule.const !== loss[key]) out.push(`${key} is not ${String(rule.const)}`)
    else if (rule.enum && !rule.enum.includes(loss[key])) out.push(`${key} outside its enum`)
  }
  return out
}

// carve#3098 adds this code to the published schema after the engine reports it.
const aheadOfPinCodes: string[] = []

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

/** A raw block, a ruby, a denied destination and an editorial comment. */
const namedLosses = () => ({
  type: 'document',
  srcByteLength: 0,
  children: [
    { type: 'raw_block', format: 'html', content: '<b>x</b>' },
    { type: 'paragraph', children: [{ type: 'ruby', pairs: [{ base: [{ type: 'text', value: 'a' }], annotation: [{ type: 'text', value: 'b' }] }] }] },
    { type: 'paragraph', children: [{ type: 'link', href: 'javascript:alert(1)', children: [{ type: 'text', value: 'x' }] }] },
    { type: 'paragraph', children: [{ type: 'critic_comment', text: 'note' }] },
  ],
})

const collect = (
  render: (ast: never, opts: never) => string,
  wire: unknown,
  opts: Record<string, unknown> = {},
): RenderLoss[] => {
  const losses: RenderLoss[] = []
  render(resolve(fromAstJson(wire as never)) as never, { ...opts, onRenderLoss: (loss: RenderLoss) => losses.push(loss) } as never)
  return losses
}

/*
 * An authored attribute under a name PART 10 §13a reserves for a roundtrip
 * carrier. It is DROPPED and the drop reported, which is one code, and
 * the only one that needs an export option on to be reachable, so the sweep
 * below renders this one with `roundtrip` enabled.
 */
const collidesWithCarrier = (): unknown => ({
  type: 'document',
  srcByteLength: 0,
  children: [
    { type: 'thematic_break', marker: '*', attrs: { keyValues: { 'data-char': 'Z' } } },
  ],
})

const targets = { carve: renderCarve, markdown: renderMarkdown, plain: renderPlainText, ansi: renderAnsi, html: renderHtml }

describe('the render-loss code enum', () => {
  it('names eleven codes in the selected schema', () => {
    expect(schemaCodes()).toEqual([
      'raw-format-dropped',
      'ruby-flattened',
      'destination-denied',
      'editorial-comment-flattened',
      'carrier-attribute-dropped',
      'list-style-dropped',
      'list-delimiter-changed',
      'table-span-flattened',
      'table-header-row-demoted',
      'table-header-row-hoisted',
      'table-header-cell-demoted',
    ])
  })

  it('names no interchange-only shape on any target', () => {
    for (const [target, render] of Object.entries(targets)) {
      expect(collect(render as never, interchangeOnly()), target).toEqual([])
    }
  })

  it('emits only codes the schema permits, and emits every one of them', () => {
    const seen = new Set<string>()
    expect(carveToMarkdownWithReport(':: Outer\n: body\n\n  :: Inner\n  : inner body\n', { roundtrip: true }).losses).toEqual([])
    for (const [target, render] of Object.entries(targets)) {
      for (const loss of [
        ...collect(render as never, interchangeOnly()),
        ...collect(render as never, namedLosses()),
        ...collect(render as never, collidesWithCarrier(), { roundtrip: true }),
      ]) {
        expect([...schemaCodes(), ...aheadOfPinCodes], `${target} emitted ${loss.code}`).toContain(loss.code)
        seen.add(loss.code)
      }
    }
    for (const loss of carveToMarkdownWithReport('a. one\n').losses) seen.add(loss.code)
    for (const loss of carveToMarkdownWithReport('a. one\n\n1. two\n', { roundtrip: true }).losses) seen.add(loss.code)
    for (const loss of carveToMarkdownWithReport('|= First | < |\n|= Second | Cell |\n').losses) seen.add(loss.code)
    for (const loss of carveToMarkdownWithReport('|= First |\n|= Second |\n').losses) seen.add(loss.code)
    for (const loss of carveToMarkdownWithReport('| A | B |\n|= C |= D |\n').losses) seen.add(loss.code)
    for (const loss of carveToMarkdownWithReport('| A |= B |\n| C | D |\n').losses) seen.add(loss.code)
    expect([...seen].sort()).toEqual([...schemaCodes(), ...aheadOfPinCodes].sort())
  })

  it('writes every loss record in the shape the report schema accepts', () => {
    const records: RenderLoss[] = []
    for (const render of Object.values(targets)) {
      records.push(
        ...collect(render as never, interchangeOnly()),
        ...collect(render as never, namedLosses()),
        ...collect(render as never, collidesWithCarrier(), { roundtrip: true }),
      )
    }
    records.push(...carveToMarkdownWithReport('a. one\n').losses)
    records.push(...carveToMarkdownWithReport('a. one\n\n1. two\n', { roundtrip: true }).losses)
    records.push(...carveToMarkdownWithReport('| A | B |\n|= C |= D |\n').losses)
    records.push(...carveToMarkdownWithReport('| A |= B |\n| C | D |\n').losses)
    expect(records.map((loss) => loss.code)).toContain('list-delimiter-changed')
    for (const loss of records) expect(schemaViolations(loss as unknown as Record<string, unknown>), loss.code).toEqual([])
    // The checker sees a misnamed field.
    expect(schemaViolations({ code: 'list-delimiter-changed', target: 'markdown', nodeType: 'block', message: 'm', authored: '.', emitted: ')' })).not.toEqual([])
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

import { describe, expect, it } from 'vitest'
import {
  AstJsonSchemaError,
  AstJsonUnknownFieldError,
  fromAstJson,
  parse,
  toAstJson,
} from '../src/index.js'

/**
 * A CLOSED RECORD the schema nests under a node is validated at decode, at every
 * depth (markup-carve/carve-js#1055).
 *
 * `WIRE_FIELDS` and `WIRE_VALUE_KINDS` are keyed by `type`, and a record has
 * none, so the only thing that reaches one is the map of nested records the
 * generator derives. It used to name `attrs` and `pos` by hand, which described
 * the whole wire for exactly as long as they were the only two: `table.rowGroups`
 * arrived through the schema (markup-carve/carve#1186) and was validated as
 * `"object"` and nothing more. `rowGroups: {}` and `rowGroups: {junk: -5}` both
 * decoded, survived into the tree, and were published again by `toAstJson` -
 * this engine vouching for a payload it never looked at, at an interchange
 * boundary where the consumer is downstream of it.
 *
 * `rowGroups` is also where the second level matters: `bodies` is a list of
 * closed records, each carrying an `attrs`, so a check that closed only the
 * outer object would be the defect surviving its own fix.
 *
 * This engine neither produces nor reads `rowGroups` - PART 12's head/bodies/foot
 * model is not ported here. The field rides through decode and re-encode
 * untouched, which is exactly why what rides through has to be well formed.
 */
const SOURCE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'

/** A REAL payload for a real table, with `rowGroups` set on it. */
const tablePayload = (rowGroups?: unknown) => {
  const payload = JSON.parse(JSON.stringify(toAstJson(parse(SOURCE)))) as {
    children: Array<Record<string, unknown>>
  }
  const table = payload.children.find((child) => child.type === 'table')
  if (table === undefined) throw new Error('the fixture parsed to no table')
  if (rowGroups !== undefined) table.rowGroups = rowGroups
  return payload as never
}

const decodedRowGroups = (rowGroups?: unknown): unknown => {
  const tree = fromAstJson(tablePayload(rowGroups))
  const table = (tree.children as Array<Record<string, unknown>>).find(
    (child) => child.type === 'table',
  )
  return table?.rowGroups
}

describe('a nested record on an ingested node', () => {
  it('is refused when it is empty, rather than decoded as a partition of nothing', () => {
    expect(() => fromAstJson(tablePayload({}))).toThrow(AstJsonSchemaError)
    expect(() => fromAstJson(tablePayload({}))).toThrow(/required property "bodies" is missing/)
  })

  it('is refused for a property the schema does not name', () => {
    expect(() => fromAstJson(tablePayload({ junk: -5 }))).toThrow(AstJsonUnknownFieldError)
  })

  it('is refused for a count the schema gives a minimum', () => {
    expect(() =>
      fromAstJson(tablePayload({ headRows: -5, bodies: [], footRows: 0 })),
    ).toThrow(/"headRows" is a number where the schema gives integer>=0/)
  })

  it('is refused for a value of the wrong shape', () => {
    expect(() => fromAstJson(tablePayload({ headRows: 0, bodies: {}, footRows: 0 }))).toThrow(
      /"bodies" is an object where the schema gives array/,
    )
    expect(() => fromAstJson(tablePayload({ headRows: 0, bodies: [7], footRows: 0 }))).toThrow(
      /a number sits where the schema gives a record/,
    )
  })

  it('is refused ONE LEVEL DOWN, inside a body group', () => {
    // The half a fix that closes only the outer record would miss. Each of these
    // is the same class of defect as the outer one, at `rowGroups.bodies[0]`.
    expect(() =>
      fromAstJson(tablePayload({ headRows: 0, bodies: [{ headRows: 0 }], footRows: 0 })),
    ).toThrow(/rowGroups\.bodies\[0\]: required property "bodyRows" is missing/)

    expect(() =>
      fromAstJson(
        tablePayload({ headRows: 0, bodies: [{ headRows: 0, bodyRows: -3 }], footRows: 0 }),
      ),
    ).toThrow(/"bodyRows" is a number where the schema gives integer>=0/)

    expect(() =>
      fromAstJson(
        tablePayload({
          headRows: 0,
          bodies: [{ headRows: 0, bodyRows: 1, junk: 1 }],
          footRows: 0,
        }),
      ),
    ).toThrow(AstJsonUnknownFieldError)
  })

  it('is refused TWO LEVELS DOWN, on the `attrs` a body group carries', () => {
    expect(() =>
      fromAstJson(
        tablePayload({
          headRows: 0,
          bodies: [{ headRows: 0, bodyRows: 1, attrs: { klass: 'x' } }],
          footRows: 0,
        }),
      ),
    ).toThrow(/rowGroups\.bodies\[0\]\.attrs carries "klass"/)
  })

  it('decodes a WELL-FORMED one and republishes it unchanged', () => {
    // The control. Without it, a decoder that refused every `rowGroups` outright
    // would pass every assertion above.
    const wellFormed = {
      headRows: 1,
      bodies: [{ headRows: 0, bodyRows: 1, rowHeadColumns: 1, attrs: { id: 'g' } }],
      footRows: 0,
    }

    expect(decodedRowGroups(wellFormed)).toEqual(wellFormed)

    const tree = fromAstJson(tablePayload(wellFormed))
    const republished = JSON.parse(JSON.stringify(toAstJson(tree))) as {
      children: Array<Record<string, unknown>>
    }
    const table = republished.children.find((child) => child.type === 'table')
    expect(table?.rowGroups).toEqual(wellFormed)

    // And the round trip stays clean: what came back out goes back in.
    expect(() => fromAstJson(republished as never)).not.toThrow()
  })

  it('leaves a table without the field alone', () => {
    expect(decodedRowGroups()).toBeUndefined()
  })
})

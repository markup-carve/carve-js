import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, AstJsonUnknownFieldError, fromAstJson, parse, toAstJson } from '../src/index.js'

const SOURCE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'

const tablePayload = (body?: unknown) => {
  const payload = structuredClone(toAstJson(parse(SOURCE))) as unknown as {
    children: Array<{ type: string; children: unknown[] }>
  }
  const table = payload.children.find(child => child.type === 'table')
  if (!table) throw new Error('the fixture parsed to no table')
  if (body !== undefined) table.children = [body]
  return payload as never
}

const validBody = { type: 'table_body', children: [], headRows: 0, rowHeadColumns: 1, attrs: { id: 'g' } }

const decodedBody = (body?: unknown): unknown => {
  const tree = fromAstJson(tablePayload(body))
  const table = tree.children.find(child => child.type === 'table')
  return table?.rowGroups
}

describe('a nested record on an ingested table group', () => {
  it('is refused when required content is missing', () => {
    expect(() => fromAstJson(tablePayload({ type: 'table_body' }))).toThrow(AstJsonSchemaError)
    expect(() => fromAstJson(tablePayload({ type: 'table_body' }))).toThrow(/required property "children" is missing/)
  })

  it('is refused for a property the schema does not name', () => {
    expect(() => fromAstJson(tablePayload({ ...validBody, junk: -5 }))).toThrow(AstJsonUnknownFieldError)
  })

  it('is refused for a count the schema gives a minimum', () => {
    expect(() => fromAstJson(tablePayload({ ...validBody, headRows: -5 }))).toThrow(/headRows.*integer>=0/)
  })

  it('is refused for a value of the wrong shape', () => {
    expect(() => fromAstJson(tablePayload({ ...validBody, children: {} }))).toThrow(/children.*array/)
    expect(() => fromAstJson(tablePayload({ ...validBody, children: [7] }))).toThrow(AstJsonSchemaError)
  })

  it('is refused ONE LEVEL DOWN, inside a row', () => {
    expect(() => fromAstJson(tablePayload({ ...validBody, children: [{ type: 'table_row' }] })))
      .toThrow(/required property "children" is missing/)
    expect(() => fromAstJson(tablePayload({ ...validBody, children: [{ type: 'table_row', children: [], junk: 1 }] })))
      .toThrow(AstJsonUnknownFieldError)
    expect(() => fromAstJson(tablePayload({ ...validBody, children: [{ type: 'table_row', children: {} }] })))
      .toThrow(/children.*array/)
  })

  it('is refused TWO LEVELS DOWN, on the group attrs', () => {
    expect(() => fromAstJson(tablePayload({ ...validBody, attrs: { klass: 'x' } })))
      .toThrow(/attrs carries "klass"/)
  })

  it('decodes a WELL-FORMED group and republishes it unchanged', () => {
    expect(decodedBody(validBody)).toBeDefined()
    const tree = fromAstJson(tablePayload(validBody))
    const republished = toAstJson(tree)
    const table = republished.children.find(child => child.type === 'table') as unknown as { children: unknown[] }
    expect(table.children).toEqual([validBody])
    expect(() => fromAstJson(republished)).not.toThrow()
  })

  it('leaves a table without an authored group alone', () => {
    expect(decodedBody()).toBeUndefined()
  })
})

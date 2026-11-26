// C2-A-219 (carve#6099): a reader of JSON text refuses, at its path, a number whose spelling does not keep its value as binary64.
import { describe, expect, it } from 'vitest'
import { decodeTree, encodeTree } from '../src/ast-json.ts'
import { CarveTreeError } from '../src/ast-validate.ts'

const declared = '"extensions":[{"name":"ex.box","version":"1","required":false,"slots":[]}]'

function boxWithProps(props: string): string {
  return `{"type":"document","astVersion":"2.0",${declared},"children":[{"type":"block_extension","name":"ex.box","version":"1",`
    + `"children":[],"fallback":[{"type":"paragraph","children":[{"type":"text","value":"f"}]}],"props":${props}}]}`
}

function metadataNumber(spelling: string): string {
  return `{"type":"document","astVersion":"2.0","children":[],"metadata":{"fields":{"n":{"kind":"number","value":${spelling}}}}}`
}

function refusedAt(json: string): string | null {
  try {
    decodeTree(json)
    return null
  } catch (error) {
    if (error instanceof CarveTreeError) return error.path
    throw error
  }
}

describe('C2-A-219: tree numbers are binary64 values', () => {
  it.each([
    '9007199254740993', '-9007199254740993', '12345678901234567890', '0.10000000000000000001', '2e-324', '-2e-324', '1e400',
    '-1e400', '1.00000000000000000001', '1e-99999999999999999999', '123456789012345678e-2',
  ])('refuses %s at its path', (spelling) => {
    expect(refusedAt(metadataNumber(spelling))).toBe('/metadata/fields/n/value')
  })

  it.each([
    ['1.0', '1'], ['1E2', '100'], ['-0', '0'], ['0.1', '0.1'], ['1e21', '1e+21'], ['5e-324', '5e-324'], ['-1.5E-7', '-1.5e-7'],
    ['9007199254740992', '9007199254740992'], ['0e999999', '0'], ['100000000000000000000', '100000000000000000000'],
    ['123456789012345', '123456789012345'], ['1.7976931348623157e308', '1.7976931348623157e+308'],
  ])('accepts %s and writes it %s', (spelling, written) => {
    expect(encodeTree(decodeTree(metadataNumber(spelling)))).toContain(`"value":${written}}`)
  })

  it('reports the path of a number nested in lists and objects of opaque props, keys escaped', () => {
    expect(refusedAt(boxWithProps('{"a/b":[1,{"c~":[2,3,9007199254740993]}]}'))).toBe('/children/0/props/a~1b/1/c~0/2')
  })

  it('reads past strings that hold digits, escaped quotes and backslashes', () => {
    expect(refusedAt(boxWithProps('{"s":"9007199254740993 \\" 1e400 \\\\","t":["\\\\\\"0.10000000000000000001"],"n":1}'))).toBeNull()
    expect(refusedAt(boxWithProps('{"s":"\\\\","n":1e400}'))).toBe('/children/0/props/n')
  })

  it('reports the path inside an envelope from its document', () => {
    const tree = metadataNumber('2e-324')
    expect(refusedAt(`{"astVersion":"2.0","document":${tree}}`)).toBe('/document/metadata/fields/n/value')
  })
})

import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'
import { type ReportRecord } from '../src/report.ts'
import { type RegisteredExtension } from '../src/extension-respell.ts'

// carve-js#5510: the 0.1 tree counts offsets in code points; records and edits use UTF-16 offsets into the input.

interface Family {
  name: string
  entry: string
  source: string
  /** The text the record's range covers, or null for a record without a range. */
  construct: string | null
  line: number
  output?: string
  registered?: RegisteredExtension[]
}

const FAMILIES: Family[] = [
  { name: 'tab report', entry: 'U-415', source: '[Label]\n:::: tabs\n::: tab\nx\n:::\n::::\n', construct: '::: tab\nx\n:::', line: 3 },
  { name: 'line block report', entry: 'U-130', source: '::: |\n😀\tx\n:::\n', construct: '::: |\n😀\tx\n:::', line: 1 },
  { name: 'table metadata line', entry: 'U-150', source: '{valigns=top,bottom widths=40}\n| a | b | c |\n',
    construct: '{valigns=top,bottom widths=40}', line: 1 },
  { name: 'empty class node', entry: 'U-282', source: '[x]{class=""}\n', construct: '[x]{class=""}', line: 1 },
  { name: 'mapped math class', entry: 'U-249', source: 'a $`x`{CLASS=foo} b\n', construct: '{CLASS=foo}', line: 1 },
  { name: 'inline rewrite', entry: 'U-066', source: 'a ~sub~ b\n', construct: null, line: 1, output: 'a {~sub~} b\n' },
  { name: 'block rewrite', entry: 'U-003', source: 'x\n{.a}\n# H\n', construct: null, line: 2, output: 'x\n\n{.a}\n# H\n' },
  { name: 'extension respelling', entry: 'U-423', source: 'see [[Page]] now\n', construct: null, line: 1,
    output: 'see :wiki[Page] now\n', registered: ['wikilinks'] },
]

function recordOf(source: string, family: Family): ReportRecord {
  const record = upgrade(source, family.registered).records.find((found) => found.entry === family.entry)
  expect(record, `${family.entry} in ${JSON.stringify(source)}`).toBeDefined()
  return record!
}

function expectAt(source: string, family: Family, construct: string | null, line: number): ReportRecord {
  const record = recordOf(source, family)
  expect(record.line).toBe(line)
  if (construct === null) return record
  const start = source.indexOf(construct)
  expect(record.range).toEqual({ startOffset: start, endOffset: start + construct.length })
  expect(source.slice(record.range!.startOffset, record.range!.endOffset)).toBe(construct)
  return record
}

describe('carve-js#5510: upgrade record positions are UTF-16 offsets and input lines', () => {
  it('gives the ticket reproduction its UTF-16 range and line', () => {
    const r = (s: string): ReportRecord | undefined => upgrade(s).records.find((x) => x.entry === 'U-415')
    expect(r('a\n\n[Label]\n:::: tabs\n::: tab\nx\n:::\n::::\n')).toMatchObject({ line: 5, range: { startOffset: 21, endOffset: 34 } })
    expect(r('😀\n\n[Label]\n:::: tabs\n::: tab\nx\n:::\n::::\n')).toMatchObject({ line: 5, range: { startOffset: 22, endOffset: 35 } })
  })

  describe.each(FAMILIES)('$name ($entry)', (family) => {
    it.each(['😀\n\n', '😀😀 a\n\n', 'a 𝄞 b 😀\nc\n\n', '\uD800 lone\n\n'])('after astral characters %j', (prefix) => {
      const lines = prefix.split('\n').length - 1
      const source = prefix + family.source
      expectAt(source, family, family.construct, family.line + lines)
      if (family.output !== undefined) expect(upgrade(source, family.registered).output).toBe(prefix + family.output)
    })

    it('before astral characters', () => {
      const source = `${family.source}\n😀 tail 😀\n`
      expectAt(source, family, family.construct, family.line)
      if (family.output !== undefined) expect(upgrade(source, family.registered).output).toBe(`${family.output}\n😀 tail 😀\n`)
    })

    it('with CRLF line endings after astral characters', () => {
      const source = `😀\r\n\r\n${family.source.replaceAll('\n', '\r\n')}`
      const construct = family.construct?.replaceAll('\n', '\r\n') ?? null
      expectAt(source, family, construct, family.line + 2)
      if (family.output !== undefined) {
        expect(upgrade(source, family.registered).output).toBe(`😀\r\n\r\n${family.output.replaceAll('\n', '\r\n')}`)
      }
    })
  })

  it.each([
    ['a tab whose label holds astral characters', 'U-415',
      '😀\n\n[😀 Label 😀]\n:::: tabs\n::: tab\n😀 x 😀\n:::\n::::\n', '::: tab\n😀 x 😀\n:::', 5],
    ['a line block that holds astral characters', 'U-130', '😀\n\n::: |\n😀😀\tx 😀\n:::\n', '::: |\n😀😀\tx 😀\n:::', 3],
    ['an empty class span around astral text', 'U-282', '😀 a\n\n[😀 x 😀]{class=""}\n', '[😀 x 😀]{class=""}', 3],
  ] as const)('covers %s', (_name, entry, source, construct, line) => {
    expectAt(source, { name: '', entry, source, construct, line }, construct, line)
  })

  it('rewrites an inline construct that holds astral characters after astral text', () => {
    expect(upgrade('😀 a ~s😀b~ c\n').output).toBe('😀 a {~s😀b~} c\n')
    expect(upgrade('😀 see [[P😀ge]] now\n', ['wikilinks']).output).toBe('😀 see :wiki[P😀ge] now\n')
  })
})

describe('carve-js#5510: ranges point into the input when the upgrade normalizes it', () => {
  it.each([
    ['a BOM', '﻿😀\n\n::: |\n😀\tx\n:::\n', '::: |\n😀\tx\n:::'],
    ['a BOM and CRLF', '﻿😀\r\n\r\n::: |\r\n😀\tx\r\n:::\r\n', '::: |\r\n😀\tx\r\n:::'],
    ['CRLF with the construct at the end of the text', '😀\r\n\r\n::: |\r\n😀\tx\r\n:::', '::: |\r\n😀\tx\r\n:::'],
  ])('%s', (_name, source, construct) => {
    const record = upgrade(source).records.find((found) => found.entry === 'U-130')
    expect(record?.line).toBe(3)
    expect(source.slice(record!.range!.startOffset, record!.range!.endOffset)).toBe(construct)
  })
})

// C2-A-040, C2-A-161 (carve-js#5398): an empty text that coalesces into a nonempty neighbor is written as nothing.
import { describe, expect, it } from 'vitest'
import { type Block, type DocumentNode, type Inline } from '../src/ast.ts'
import { parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

const text = (value: string): Inline => ({ type: 'text', value })
const emphasis = (children: Inline[]): Inline => ({ type: 'emphasis', children })
const strong = (children: Inline[]): Inline => ({ type: 'strong', children })
const documentOf = (block: Block): DocumentNode => ({ type: 'document', astVersion: '2.0', children: [block] })
const paragraph = (children: Inline[]): DocumentNode => documentOf({ type: 'paragraph', children })
const written = (document: DocumentNode): [string, string[]] => {
  const output = writeWithDiagnostics(document)
  return [output.source, output.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)]
}

describe('carve-js#5398: empty texts beside a nonempty text', () => {
  it.each([
    ['after', [text('a'), text('')], 'a\n'],
    ['before', [text(''), text('a')], 'a\n'],
    ['around', [text(''), text('a'), text('')], 'a\n'],
    ['inside emphasis', [emphasis([text('`x`'), text('')])], '/\\`x\\`/\n'],
    ['inside strong', [strong([text(''), text('a'), text('')])], '*a*\n'],
    ['before a construct', [text('a'), text(''), emphasis([text('b')])], 'a{/b/}\n'],
    ['before line-end spaces', [text('a '), text('')], 'a\n'],
  ] as [string, Inline[], string][])('%s', (_, children, source) => {
    expect(written(paragraph(children))).toEqual([source, []])
  })

  it('writes the bytes of the coalesced tree in every host', () => {
    const hosts = (children: Inline[]): DocumentNode[] => [
      paragraph(children),
      documentOf({ type: 'heading', level: 1, children } as Block),
      paragraph([text('p'), emphasis(children)]),
      paragraph([strong(children)]),
    ]
    let checked = 0
    for (const value of ['a', '`x`', '*', '{', '1.', '#']) {
      for (const shape of [[text(value), text('')], [text(''), text(value)], [text(''), text(value), text('')]]) {
        const coalesced = hosts([text(value)])
        hosts(shape).forEach((document, at) => {
          const expected = written(coalesced[at]!)
          expect(written(document)).toEqual(expected)
          if (expected[1].length === 0) expect(treesEqual(parse(expected[0]), document)).toBe(true)
          checked++
        })
      }
    }
    expect(checked).toBe(72)
  })

  it('leaves the supplied tree as it was', () => {
    const document = paragraph([text('a'), text(''), emphasis([text(''), text('b')])])
    const before = JSON.stringify(document)
    writeWithDiagnostics(document)
    expect(JSON.stringify(document)).toBe(before)
  })

  it('still reports a run of only empty texts', () => {
    expect(written(paragraph([text(''), text('')]))[1]).not.toEqual([])
    expect(written(paragraph([text('a'), emphasis([text('')])]))[1]).not.toEqual([])
  })

  it('keeps an empty text with a field, and locates later losses in the supplied tree', () => {
    expect(written(paragraph([text('a'), { ...text(''), lang: 'de' } as Inline]))[1])
      .toEqual(['structure-unspellable /children/0'])
    const [, losses] = written(paragraph([text(''), text('a'), text(''), text('b'), { ...text('c'), lang: 'de' } as Inline]))
    expect(losses).toEqual(['structure-unspellable /children/0'])
  })
})

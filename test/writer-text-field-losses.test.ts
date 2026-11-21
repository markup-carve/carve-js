// C2-W-117, C2-W-151 (carve#6343): lang, dir and metadata on a supplied text are never dropped without a report.
import { describe, expect, it } from 'vitest'
import { type Block, type DocumentNode, type Inline } from '../src/ast.ts'
import { treesEqual, writeWithDiagnostics } from '../src/index.ts'

const text = (value: string): Inline => ({ type: 'text', value })
const withField = (value: string, name: string, field: unknown): Inline => ({ ...text(value), [name]: field }) as Inline
const documentOf = (block: Block): DocumentNode => ({ type: 'document', astVersion: '2.0', children: [block] })
const paragraph = (children: Inline[]): DocumentNode => documentOf({ type: 'paragraph', children })
const reports = (document: DocumentNode): string[] =>
  writeWithDiagnostics(document).diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)
const FIELDS: [string, unknown][] = [['lang', 'de'], ['dir', 'rtl'], ['metadata', { title: [text('t')] }]]

describe('carve#6343: text fields the writer cannot spell are reported', () => {
  it.each(FIELDS)('%s on a text of only line-end spaces', (name, field) => {
    const output = writeWithDiagnostics(paragraph([text('a'), withField('  ', name, field)]))
    expect(output.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)).toEqual(['structure-unspellable /children/0'])
  })

  it.each(FIELDS)('%s on a text after a text', (name, field) => {
    expect(reports(paragraph([text('a'), withField('b', name, field)]))).toEqual(['structure-unspellable /children/0'])
  })

  it('plain adjacent texts still write quietly', () => {
    const output = writeWithDiagnostics(paragraph([text('a'), text('b')]))
    expect(output.source).toBe('ab\n')
    expect(output.diagnostics).toEqual([])
  })

  it('every variant across hosts reports a loss', () => {
    const hosts = (children: Inline[]): DocumentNode[] => [
      paragraph(children),
      documentOf({ type: 'heading', level: 2, children } as Block),
      documentOf({ type: 'line_block', children: [{ type: 'line', children }] } as Block),
      paragraph([text('x '), { type: 'emphasis', children } as Inline]),
    ]
    const soft: Inline = { type: 'soft_break' }
    let checked = 0
    for (const [name, field] of FIELDS) {
      for (const value of ['  ', '\t', ' \t', 'b', 'b ', 'b\t', 'b c ']) {
        const t = withField(value, name, field)
        const shapes: Inline[][] = [
          [t], [text('a'), t], [text('a '), t, soft, text('z')], [text('a'), t, text('z')], [t, text('z')], [text('a'), t, text('y'), t],
        ]
        for (const shape of shapes) {
          for (const tree of hosts(shape)) {
            expect(reports(tree), JSON.stringify(tree)).not.toEqual([])
            checked++
          }
        }
      }
    }
    expect(checked).toBe(3 * 7 * 6 * 4)
  })

  it('C2-A-161: adjacent texts join only where their other fields agree', () => {
    const one = paragraph([withField('ab', 'lang', 'de')])
    expect(treesEqual(paragraph([withField('a', 'lang', 'de'), withField('b', 'lang', 'de')]), one)).toBe(true)
    expect(treesEqual(paragraph([withField('a', 'lang', 'de'), withField('b', 'lang', 'fr')]), one)).toBe(false)
    expect(treesEqual(paragraph([withField('a', 'lang', 'de'), text('b')]), one)).toBe(false)
    expect(treesEqual(paragraph([text('a'), text('b')]), paragraph([text('ab')]))).toBe(true)
  })
})

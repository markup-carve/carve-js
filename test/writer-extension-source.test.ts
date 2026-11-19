import { expect, it } from 'vitest'
import { citeExtension, decodeTree, parse, wikiExtension, writeWithDiagnostics } from '../src/index.ts'
import { sourceCoreEquivalent } from '../src/write-extension-source.ts'

it('C2-X-023: a core readback with another body is not the extension source', () => {
  const expected = { type: 'block_extension' as const, name: 'ex.box', version: '1', children: [],
    fallback: [], source: { form: 'div' as const, name: 'box', body: 'x\n' } }
  const actual = { type: 'div' as const, attrs: { classes: ['box'] },
    children: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, value: 'wrong' }] }] }
  expect(sourceCoreEquivalent(expected, actual)).toBe(false)
})

it('C2-X-023: the inline source form of an extension is written without a loss', () => {
  const extensions = [wikiExtension, citeExtension]
  for (const source of [':wiki[Page] and :cite[doe]{locator="p. 4"}\n', '*:wiki[Page /x/]*\n', '- :cite[x]{.c}\n', '| :wiki[P] | b |\n']) {
    const result = writeWithDiagnostics(parse(source, { extensions }))
    expect([result.source, result.diagnostics]).toEqual([source, []])
  }
})

it('C2-X-023: an inline source body that reads back as other content still reports a loss', () => {
  const tree = parse(':wiki[Page]', { extensions: [wikiExtension], positions: false })
  const paragraph = tree.children[0]
  if (paragraph?.type !== 'paragraph' || paragraph.children[0]?.type !== 'inline_extension') throw new Error('no extension')
  paragraph.children[0].source = { form: 'inline', name: 'wiki', body: 'a]b' }
  const result = writeWithDiagnostics(decodeTree(JSON.stringify(tree)))
  expect(result.diagnostics.length).toBeGreaterThan(0)
})

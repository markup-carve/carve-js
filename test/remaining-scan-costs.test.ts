import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, createEditorSession, diffAst, lintCarve, mergeAst, parseWithSourceLayout } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

const paragraphs = (n: number, value: string) => `${value}\n\n`.repeat(n)

describe('remaining scan costs', () => {
  it('keeps failed destinations literal and accepts balanced destinations', () => {
    expect(carveToHtml('[x]([x]([x]()')).toBe('<p>[x]([x]([x]()</p>')
    expect(carveToHtml('[x](a(b)c "title")')).toContain('href="a(b)c" title="title"')
  })

  it('rejects quoted invalid attributes without losing the trailing valid span', () => {
    const input = '[x]{k="'.repeat(40) + '"}'
    expect(carveToHtml(input).match(/<span /g)).toHaveLength(1)
    expect(carveToHtml('[x]{k="a"[y]{.b}')).toContain('<span class="b">y</span>')
    expect(carveToHtml('[x]{k="a" .b}')).toContain('k="a"')
  })

  it('maps scalar offsets to UTF-8 bytes', () => {
    const source = '# 😀é\n\ntext\n'
    const { layout } = parseWithSourceLayout(source)
    for (const node of layout.nodes) {
      expect(node.startByte).toBeLessThanOrEqual(node.endByte)
      expect(node.endByte).toBeLessThanOrEqual(new TextEncoder().encode(source).length)
    }
  })

  it('reports every changed paragraph past the LCS limit', () => {
    const changes = diffAst(carveToAstJson(paragraphs(1100, 'a')), carveToAstJson(paragraphs(1100, 'b')))
    expect(changes.filter(change => change.kind === 'changed')).toHaveLength(1100)
  })

  it('deduplicates concurrent additions in occurrence order', () => {
    const result = mergeAst(carveToAstJson(''), carveToAstJson('a\n\na\n\nb\n'), carveToAstJson('a\n\nb\n\nb\n'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ast.children).toHaveLength(4)
  })

  for (const unit of ['[x](', '*[x](', '[x]{k="', '[x]{k=', '[x]{k=a ', ':foo[x]{k="', '^[', '[^', '{~', '{=', '{#']) {
    perfIt(`failed tail ${unit} scales with source bytes`, () => {
      expectBuiltInputScansLinearly(input => void carveToHtml(input), n => unit.repeat(n) + (unit.includes('{') ? '"}' : ')'), { smallRepeats: 2000, label: unit })
    })
  }

  perfIt('source layout scales with positioned paragraphs', () => {
    expectBuiltInputScansLinearly(input => void parseWithSourceLayout(input), n => paragraphs(n, 'a'), { smallRepeats: 1000, label: 'source layout' })
  })

  perfIt('large changed sibling lists stay bounded', () => {
    expectBuiltInputScansLinearly(input => void diffAst(carveToAstJson(input), carveToAstJson(input.replaceAll('a', 'b'))), n => paragraphs(n, 'a'), { smallRepeats: 2000, label: 'AST diff' })
  })

  perfIt('concurrent additions use indexed matching', () => {
    const base = carveToAstJson('')
    expectBuiltInputScansLinearly(input => void mergeAst(base, carveToAstJson(input), carveToAstJson(input.replaceAll('a', 'b'))), n => paragraphs(n, 'a'), { smallRepeats: 1000, label: 'merge additions' })
  })

  perfIt('platform lint masks failed destinations once', () => {
    expectBuiltInputScansLinearly(input => void lintCarve(input, { platforms: ['github'] }), n => '[x]('.repeat(n) + ')', { smallRepeats: 2000, label: 'lint destinations' })
  })

  perfIt('editor attribute token mapping avoids prefix rescans', () => {
    expectBuiltInputScansLinearly(input => void createEditorSession(input), n => '{.a}\na\n\n'.repeat(n), { smallRepeats: 1000, label: 'editor attributes' })
  })
})

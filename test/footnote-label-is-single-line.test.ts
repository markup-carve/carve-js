import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, lintCarve } from '../src/index.js'

const inlineTypes = (source: string) => {
  const paragraph = carveToAstJson(source).children[0]
  return paragraph.type === 'paragraph' ? paragraph.children.map((node) => node.type) : []
}

describe('a footnote label is a physical-line identifier', () => {
  it.each(['\n', '\r\n', '\r'])('does not cross a %j line ending', (ending) => {
    const source = `before[^two${ending}words].\n`
    expect(carveToHtml(source)).not.toContain('doc-noteref')
    expect(inlineTypes(source)).toEqual(['text', 'soft_break', 'text'])
    expect(lintCarve(source).map((warning) => warning.rule)).not.toContain('unresolved-footnote')
  })

  it('does not turn a multiline definition marker into a definition', () => {
    const source = 'see[^two words].\n\n[^two\nwords]: note.\n'
    const ast = carveToAstJson(source)
    expect(ast.children.some((node) => node.type === 'footnote')).toBe(false)
    expect(carveToHtml(source)).not.toContain('doc-endnotes')
    expect(carveToCarve(source)).toBe(source)
  })

  it.each(['two words', 'two\twords'])('still resolves the same-line label %j exactly', (label) => {
    expect(carveToHtml(`see[^${label}].\n\n[^${label}]: note.\n`)).toContain('doc-noteref')
  })
})

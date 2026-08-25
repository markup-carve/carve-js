import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('cross-references inside a line block', () => {
  it('resolves against a heading like the same reference in a paragraph', () => {
    const source = '# H\n::: |\n</#h>\n'

    expect(carveToHtml(source)).toContain('<p><a href="#H">H</a></p>')

    const ast = carveToAstJson(source)
    const lineBlock = ast.children[1] as Record<string, unknown>
    const paragraph = (lineBlock.children as Array<Record<string, unknown>>)[0]!
    const reference = (paragraph.children as Array<Record<string, unknown>>)[0]!
    expect(reference).toMatchObject({ type: 'heading_ref', target: 'h', href: '#H' })
  })

  it('keeps an unresolved reference literal', () => {
    expect(carveToHtml('::: |\n</#missing>\n')).toContain('&lt;/#missing&gt;')
  })
})

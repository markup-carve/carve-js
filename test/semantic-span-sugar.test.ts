import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderAnsi, renderCarve, renderPlainText, semanticSpan } from '../src/index.js'

/*
 * The compact spelling, which is now the ONLY spelling core reserves (PART 9
 * §9). Its neighbour file covers the tier boundary; this one covers the shape
 * of the rendering itself.
 */
describe('semantic span attributes', () => {
  it('renders core names and their value mappings', () => {
    expect(carveToHtml('[HTML]{abbr="HyperText Markup Language"}\n[Noon]{time="12:00"} [Tab]{kbd}')).toBe(
      '<p><abbr title="HyperText Markup Language">HTML</abbr>\n' +
      '<time datetime="12:00">Noon</time> <kbd>Tab</kbd></p>',
    )
  })

  it('rides remaining hardened attributes on the element, not a wrapper', () => {
    expect(carveToHtml('[*Ctrl*+C]{#copy .shortcut kbd data-key="copy" onclick="alert(1)"}')).toBe(
      '<p><kbd id="copy" class="shortcut" data-key="copy"><strong>Ctrl</strong>+C</kbd></p>',
    )
  })

  it('combines wrappers, which the deprecated spelling cannot', () => {
    const html = carveToHtml('[CSS]{kbd abbr="Cascading Style Sheets"}', { extensions: [semanticSpan()] })
    expect(html).toBe('<p><kbd><abbr title="Cascading Style Sheets">CSS</abbr></kbd></p>')
    // `:kbd[:abbr[CSS]]` does not nest - the outer body stops at the first `]`.
    expect(carveToHtml(':kbd[:abbr[CSS]]', { extensions: [semanticSpan()] }))
      .toBe('<p><kbd>:abbr[CSS</kbd>]</p>')
  })

  it('preserves the ordinary span AST and non-HTML targets', () => {
    const source = '[Ctrl]{kbd}'
    const doc = parse(source)
    const node = doc.children[0]!.type === 'paragraph' ? doc.children[0]!.children[0]! : undefined
    expect(node).toMatchObject({ type: 'span', attrs: { keyValues: { kbd: '' } } })
    expect(renderPlainText(doc)).toBe('Ctrl\n')
    expect(renderAnsi(doc)).toBe('Ctrl\n')
    expect(renderCarve(doc)).toBe('[Ctrl]{kbd}\n')
  })

  it('leaves unknown and case-variant attributes ordinary', () => {
    expect(carveToHtml('[x]{widget KBD}')).toBe('<p><span widget="" KBD="">x</span></p>')
  })
})

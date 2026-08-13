import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderAnsi, renderCarve, renderPlainText } from '../src/index.js'

describe('compact semantic span attributes', () => {
  it('renders the fixed registry and value mappings', () => {
    expect(carveToHtml('[CSS]{dfn abbr="Cascading Style Sheets"}\n[Noon]{time="12:00"} [x]{code mark samp var kbd cite}')).toBe(
      '<p><dfn><abbr title="Cascading Style Sheets">CSS</abbr></dfn>\n' +
      '<time datetime="12:00">Noon</time> <span code="" mark=""><cite><kbd><var><samp>x</samp></var></kbd></cite></span></p>',
    )
  })

  it('keeps remaining hardened attributes on one outer span', () => {
    expect(carveToHtml('[*Ctrl*+C]{#copy .shortcut kbd data-key="copy" onclick="alert(1)"}')).toBe(
      '<p><span id="copy" class="shortcut" data-key="copy"><kbd><strong>Ctrl</strong>+C</kbd></span></p>',
    )
  })

  it('preserves the ordinary span AST and non-HTML targets', () => {
    const source = '[Ctrl]{kbd}'
    const doc = parse(source)
    const node = doc.children[0]!.type === 'paragraph' ? doc.children[0]!.children[0]! : undefined
    expect(node).toMatchObject({ type: 'span', attrs: { keyValues: { kbd: '' } } })
    expect(renderPlainText(doc)).toBe('Ctrl\n')
    expect(renderAnsi(doc)).toBe('Ctrl\n')
    // PART 11 §6c: a value-less attribute comes back as the bare name, which is
    // also the form PART 9 §10 documents for this construct.
    expect(renderCarve(doc)).toBe('[Ctrl]{kbd}\n')
  })

  it('leaves unknown and case-variant attributes ordinary', () => {
    expect(carveToHtml('[x]{widget KBD}')).toBe('<p><span widget="" KBD="">x</span></p>')
  })

  it('lets an explicit abbr value take precedence over automatic expansion', () => {
    expect(carveToHtml('*[HTML]: Hyper Text Markup Language\n\n[HTML]{abbr="Custom"}')).toBe(
      '<p><abbr title="Custom">HTML</abbr></p>',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('differential audit regressions', () => {
  it('keeps an empty marker separator when it is term continuation content', () => {
    expect(carveToHtml(':: t\n* \n')).toContain('<dt>t\n* </dt>')
    expect(carveToHtml(':: t\n- \n')).toContain('<dt>t\n- </dt>')
    expect(carveToHtml(':: t\n. \n')).toContain('<dt>t\n. </dt>')
    expect(carveToHtml(':: t\n] \n')).toContain('<dt>t\n] </dt>')
    expect(carveToHtml(':: . \n')).toContain('<dt>.</dt>')
  })

  it('does not promote a one-cell whitespace row to a table', () => {
    expect(carveToHtml('* | |\n')).toContain('<li>| |</li>')
  })

  it('reads an unclosed dollar-prefixed verbatim run as math', () => {
    expect(carveToHtml('$`x\n')).toBe('<p><span class="math inline">\\(x\\)</span></p>')
    expect(carveToHtml('$`\n')).toBe('<p>$<code></code></p>')
  })

  it('requires real abbreviation content after the separator run', () => {
    expect(carveToHtml('*[A]:  \n')).toBe('<p>*[A]:</p>')
  })

  it('accepts a tab as padding only after the required marker space', () => {
    expect(carveToHtml('. \tb\n')).toContain('<li>b</li>')
    expect(carveToHtml('- \tb\n')).toContain('<li>b</li>')
  })

  it('keeps a marker-line attribute with the block it floats onto', () => {
    expect(carveToHtml('* {i}\n|\n')).toContain('<li><p i="">|</p></li>')
  })

  it('strips closed verbatim padding across physical lines', () => {
    expect(carveToHtml('H``` x\n* ```\n')).toBe('<p>H<code>x\n*</code></p>')
  })

  it('does not let an unclosed line-block code span consume the next verse line', () => {
    expect(carveToHtml('::: |\n`\n}\n')).toContain('<p><code></code><br>\n}</p>')
  })

  it('absorbs a bare colon run after an indented malformed opener', () => {
    expect(carveToHtml(' :::e\n:::\n')).toBe('<p>:::e\n:::</p>')
  })

  it('anchors a line-block hard break to the source line when tabs expand', () => {
    const ast = carveToAstJson('::: |\nwide\t\tgap\nnext\n:::\n')
    const hardBreak = ast.children[0].children[0].children[1]
    expect(hardBreak.type).toBe('hard_break')
    expect(hardBreak.pos.startOffset).toBe(15)
    expect(hardBreak.pos.endOffset).toBe(16)
  })

  it('uses visible autolink text and image alt text in heading keys', () => {
    const autolink = carveToHtml('# a <https://e.com> b\n\n[a <https://e.com> b][]\n')
    expect(autolink).toContain('id="a-https-e-com-b"')
    expect(autolink).toContain('href="#a-https-e-com-b"')
    const image = carveToHtml('# a ![alt](/i.png) b\n\n[a ![alt](/i.png) b][]\n')
    expect(image).toContain('id="a-alt-b"')
    expect(image).toContain('href="#a-alt-b"')
  })
})

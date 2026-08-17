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

  it('ends the item on a marker-line attribute, which floats onto nothing', () => {
    // Was `<li><p i="">|</p></li>`. markup-carve/carve#1280 ruled the other way:
    // an attribute block leaves no open paragraph, so PART 1 S4 ends the item at
    // the column-0 line and the attribute reaches no block at all (corpus
    // 326-…-no-paragraph-open-9). carve-rs `b6ff319c` produces this.
    expect(carveToHtml('* {i}\n|\n')).toBe('<ul>\n  <li></li>\n</ul>\n<p>|</p>')
  })

  it('strips closed verbatim padding across physical lines', () => {
    expect(carveToHtml('H``` x\n* ```\n')).toBe('<p>H<code>x\n*</code></p>')
  })

  it('lets an unclosed line-block code span reach the end of the stanza', () => {
    // markup-carve/carve#1282 (carve-js#1116) ruled the other way round from
    // what this row pinned: `edge-cases.md:2205` says an unclosed verbatim run
    // renders to the end of the BLOCK, and a line block is a block. The run
    // therefore swallows the newline - literally, as a newline - and no `<br>`
    // is left to render. carve-rs `9b0bc779` produces exactly this, including
    // for an UNTERMINATED line block as here.
    expect(carveToHtml('::: |\n`\n}\n')).toBe(
      '<div class="line-block">\n  <p><code>\n}</code></p>\n</div>',
    )
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

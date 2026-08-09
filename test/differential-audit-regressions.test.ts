import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

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
})

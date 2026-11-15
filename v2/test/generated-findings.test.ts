import { describe, expect, it } from 'vitest'
import { parse, render, tabExtension, tabsExtension, tabsRenderer, validateTree } from '../src/index.ts'

describe('generated parser findings', () => {
  it('C2-A-143, C2-B-165: a leading byte order mark takes no column', () => {
    const source = '\ufeffP'
    const document = parse(source)
    expect(document.children[0]?.pos?.startColumn).toBe(1)
    expect(() => validateTree(document, undefined, source)).not.toThrow()
  })

  it('C2-A-093, C2-B-173: a row span continues from the body into the footer', () => {
    const source = '{footer-rows}\n||\n|^|\n|^|\n'
    expect(() => validateTree(parse(source), undefined, source)).not.toThrow()
  })

  it('C2-H-176: text that HTML cannot carry literally is replaced', () => {
    for (const character of ['\u001d', '\ufdd5', '\ud800', '\u0000', '\u007f', '\ud83f\udffe']) {
      expect(render(character)).toBe('<p>\ufffd</p>')
    }
  })

  it('C2-H-176, C2-X-043: tab content uses the same HTML text rule', () => {
    const source = ':::: tabs\n::: tab "One"\n\u001d\n:::\n::::\n'
    const html = render(source, { extensions: [tabExtension, tabsExtension], renderers: { 'carve.tabs': tabsRenderer } })
    expect(html).toContain('<p>\ufffd</p>')
  })
})

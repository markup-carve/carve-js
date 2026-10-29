import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('nested marker-line footnote paragraphs', () => {
  it.each([
    ['~~~', '~~~'], ['+', '+'], ['- x', '- x'],
  ])('keeps a below-column %s line in the deepest open paragraph', (line, rendered) => {
      const source = `[^c]: [^d]: para\n        more\n ${line}\n\nSee[^c][^d]\n`
      const html = carveToHtml(source)
      expect(html).toContain(`<p>para\nmore\n${rendered}<a href="#fnref2"`)
    })

  it.each([
    ['# H', '<h1>H</h1>'], ['---', '<hr>\n<p>See'], ['> q', '<blockquote><p>q</p></blockquote>'],
    ['| a |', '<tr><td>a</td></tr>'], [':: term', '<dt>term</dt>'],
  ])('releases a below-column %s line from the deepest open paragraph', (line, rendered) => {
      const source = `[^c]: [^d]: para\n        more\n ${line}\n\nSee[^c][^d]\n`
      const html = carveToHtml(source)
      expect(html).toContain(rendered)
      expect(html).toContain('<p>para\nmore<a href="#fnref2"')
    })

  it('releases a heading recognized at document column zero', () => {
    const source = '[^c]: [^d]: para\n        more\n# H\n\nSee[^c][^d]\n'
    const html = carveToHtml(source)
    expect(html).toContain('<h1>H</h1>')
    expect(html).toContain('<p>para\nmore<a href="#fnref2"')
  })
})

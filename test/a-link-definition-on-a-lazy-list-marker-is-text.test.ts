import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a link definition behind a lazy list marker', () => {
  const unresolved = '<p>[go][d]</p>'

  it.each([
    ['document prose', 'para\n* [d]: u\n\n[go][d]\n', '<p>para\n* [d]: u</p>'],
    ['quoted prose', '> r\n> - [d]: u\n\n[go][d]\n', '<blockquote><p>r\n- [d]: u</p></blockquote>'],
    ['prose in a div', '::: n\nr\n- [d]: u\n:::\n\n[go][d]\n', '<div class="n">\n  <p>r\n- [d]: u</p>\n</div>'],
    [
      'a second quoted marker',
      '> r\n> - a\n> - [d]: u\n\n[go][d]\n',
      '<blockquote><p>r\n- a\n- [d]: u</p></blockquote>',
    ],
    ['a quote behind a lazy list marker', 'para\n- > [d]: u\n\n[go][d]\n', '<p>para\n- &gt; [d]: u</p>'],
    [
      'a nested quote behind a lazy list marker',
      '> para\n> - > [d]: u\n\n[go][d]\n',
      '<blockquote><p>para\n- &gt; [d]: u</p></blockquote>',
    ],
  ])('keeps the definition-shaped line as %s', (_name, source, paragraph) => {
    expect(carveToHtml(source)).toBe(`${paragraph}\n${unresolved}`)
  })

  it.each([
    ['item continuation prose', '- a\n  more\n* [d]: u\n\n[go][d]\n'],
    ['lazy item prose', '- a\nlazy\n* [d]: u\n\n[go][d]\n'],
  ])('still collects after %s', (_name, source) => {
    expect(carveToHtml(source)).toContain('<a href="u">go</a>')
  })

  it('still collects when a fresh quote interrupts top-level prose', () => {
    expect(carveToHtml('para\n> - [d]: u\n\n[go][d]\n')).toContain('<a href="u">go</a>')
  })

  it('keeps a footnote definition behind a lazy list and quote marker as text', () => {
    expect(carveToHtml('para\n- > [^f]: t\n\nuse[^f]\n')).toBe(
      '<p>para\n- &gt; [^f]: t</p>\n<p>use[^f]</p>',
    )
  })

  it('does not change abbreviation collection', () => {
    expect(carveToHtml('para\n*[A]: expansion\n\nA\n')).toBe('<p>para</p>\n<p><abbr title="expansion">A</abbr></p>')
  })
})

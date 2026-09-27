import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import { parse } from '../src/parse.js'

/*
 * A definition term has no content column, so a block opener indented past the
 * enclosing container's content column is term text at every depth
 * (markup-carve/carve#2411). List markers keep Rule B and still open.
 */
const flat = (source: string) => carveToHtml(source).replace(/\n\s*/g, '')

describe('a term folds an indented block opener at every depth', () => {
  it.each([
    ['top level heading', ':: c\n  # H\n', '<dl><dt>c\n  # H</dt></dl>'],
    ['quoted heading', '> :: c\n>   # H\n', '<blockquote><dl><dt>c\n  # H</dt></dl></blockquote>'],
    ['heading in a list item', '- item\n\n  :: c\n    # H\n', '<ul><li>item<dl><dt>c\n  # H</dt></dl></li></ul>'],
    [
      'heading in a description',
      ':: a\n: b\n  :: c\n    # H\n',
      '<dl><dt>a</dt><dd><p>b</p><dl><dt>c\n  # H</dt></dl></dd></dl>',
    ],
    [
      'note in a description',
      ':: a\n: b\n  :: c\n    ::: note\n    body\n    :::\n',
      '<dl><dt>a</dt><dd><p>b</p><dl><dt>c\n  ::: note\n  body\n  :::</dt></dl></dd></dl>',
    ],
    [
      'note in a list item',
      '- item\n\n  :: c\n    ::: note\n    body\n    :::\n',
      '<ul><li>item<dl><dt>c\n  ::: note\n  body\n  :::</dt></dl></li></ul>',
    ],
    [
      'second term in a description',
      ':: a\n: b\n  :: c\n    :: d\n',
      '<dl><dt>a</dt><dd><p>b</p><dl><dt>c\n  :: d</dt></dl></dd></dl>',
    ],
  ])('%s', (_name, source, html) => {
    expect(flat(source)).toBe(html.replace(/\n\s*/g, ''))
  })

  it('opens the block at the container content column', () => {
    expect(flat(':: a\n: b\n  :: c\n  # H\n')).toBe(
      '<dl><dt>a</dt><dd><p>b</p><dl><dt>c</dt></dl><h1 id="H">H</h1></dd></dl>',
    )
    expect(flat(':: c\n# H\n')).toBe('<dl><dt>c</dt></dl><section id="H"><h1>H</h1></section>')
  })

  it('still lets a list marker open under a nested term', () => {
    expect(flat(':: a\n: b\n  :: c\n    - x\n')).toBe(
      '<dl><dt>a</dt><dd><p>b</p><dl><dt>c</dt></dl><ul><li>x</li></ul></dd></dl>',
    )
  })

  it('formats the folded text back to itself', () => {
    for (const source of [':: a\n: b\n  :: c\n    # H\n', '- item\n\n  :: c\n    ::: note\n    body\n    :::\n']) {
      const once = renderCarve(parse(source))
      expect(carveToHtml(once)).toBe(carveToHtml(source))
      expect(renderCarve(parse(once))).toBe(once)
    }
  })
})

describe('lintCarve - definition-term-block-folded', () => {
  const reports = (source: string) => lintCarve(source).filter((w) => w.rule === 'definition-term-block-folded')

  it('reports the first folded opener once per term, and nothing else on it', () => {
    const source = ':: a\n: b\n  :: c\n    ::: note\n    body\n    :::\n'
    expect(reports(source)).toMatchObject([{ line: 4, column: 5 }])
    expect(lintCarve(source)).toHaveLength(1)
    expect(lintCarve('- item\n\n  :: c\n    # H\n').map((w) => w.rule)).toEqual(['definition-term-block-folded'])
  })

  it('reports at top level and inside a quote', () => {
    expect(reports(':: c\n  # H\n')).toMatchObject([{ line: 2, column: 3 }])
    expect(reports('> :: c\n>   # H\n')).toMatchObject([{ line: 2, column: 5 }])
  })

  it('stays quiet for plain continuation text, list markers, and openers that open', () => {
    expect(reports(':: c\n  more text\n')).toEqual([])
    expect(reports(':: c\n  - x\n')).toEqual([])
    expect(reports(':: c\n# H\n')).toEqual([])
    expect(reports(':: a\n: b\n  :: c\n  # H\n')).toEqual([])
  })
})

describe('what ends a nested term before an indented opener', () => {
  it('keeps a comment or a definition as the term boundary', () => {
    const heading = '<dl><dt>a</dt><dd><p>b</p><dl><dt>c</dt></dl><h1 id="H">H</h1></dd></dl>'
    expect(flat(':: a\n: b\n  :: c\n    %% note\n    # H\n')).toBe(heading)
    expect(flat(':: a\n: b\n  :: c\n    [r]: /u\n    # H\n')).toBe(heading)
  })
})

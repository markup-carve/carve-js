import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

// CARVE-P0-009: a below-column line continues a paragraph only where one is open
// at the deepest frame. Otherwise it closes the list and begins a new block, and
// no surviving frame adopts it. Corpus section 556 pins these shapes.
const normalized = (html: string) =>
  html.replace(/(<h[1-6]) id="[^"]*"/g, '$1').replace(/\n\s*/g, '\n').replace(/>\n</g, '><').trim()
const lines = (...source: string[]) => source.join('\n') + '\n'
const FENCE = '```'
const read = (source: string): string => {
  const html = normalized(renderHtml(parse(source)))
  expect(normalized(renderHtml(parse(source, { positions: true })))).toBe(html)
  return html
}

describe('a block at a quoted item content column leaves the quote for the line below', () => {
  it.each([
    ['a heading', '# H', '<h1>H</h1>'],
    ['a thematic break', '***', '<hr>'],
    ['a table', '| t |', '<table><tbody><tr><td>t</td></tr></tbody></table>'],
    ['a link definition', '[x]: /u', ''],
    ['an attribute line', '{.c}', ''],
  ])('%s', (_name, block, rendered) => {
    expect(read(lines('> - a', `>   ${block}`, 'tail'))).toBe(
      `<blockquote><ul><li>a${rendered === '' ? '' : `\n${rendered}`}</li></ul></blockquote><p>tail</p>`,
    )
  })

  it('a term', () => {
    expect(read(lines('> - a', '>   :: t', 'tail'))).toBe(
      '<blockquote><ul><li>a\n<dl><dt>t</dt></dl></li></ul></blockquote><p>tail</p>',
    )
  })

  it('a table ending on a continuation row', () => {
    expect(read(lines('> - a', '>   | t |', '>   + u |', 'tail'))).toBe(
      '<blockquote><ul><li>a\n<table><tbody><tr><td>t u</td></tr></tbody></table></li></ul></blockquote><p>tail</p>',
    )
  })

  it('an ordered item, one quote deeper and after a blank', () => {
    expect(read(lines('> 1. a', '>    # H', 'tail'))).toBe(
      '<blockquote><ol><li>a\n<h1>H</h1></li></ol></blockquote><p>tail</p>',
    )
    expect(read(lines('> > - a', '> >   # H', 'tail'))).toBe(
      '<blockquote><blockquote><ul><li>a\n<h1>H</h1></li></ul></blockquote></blockquote><p>tail</p>',
    )
    expect(read(lines('> - a', '>', '>   # H', 'tail'))).toBe(
      '<blockquote><ul><li>a\n<h1>H</h1></li></ul></blockquote><p>tail</p>',
    )
  })

  it('a list marker below opens a list of its own', () => {
    expect(read(lines('> - a', '>   # H', '1. lazy'))).toBe(
      '<blockquote><ul><li>a\n<h1>H</h1></li></ul></blockquote><ol><li>lazy</li></ol>',
    )
  })

  it('keeps the line where a paragraph is still open or the line is marked', () => {
    expect(read(lines('> - a', '>   b', 'tail'))).toBe('<blockquote><ul><li>a\nb\ntail</li></ul></blockquote>')
    expect(read(lines('> - a', '>   # H', '> tail'))).toBe(
      '<blockquote><ul><li>a\n<h1>H</h1></li></ul><p>tail</p></blockquote>',
    )
    expect(read(lines('> - a', '>     # H', 'tail'))).toBe(
      '<blockquote><ul><li>a\n<h1>H</h1></li></ul><p>tail</p></blockquote>',
    )
  })
})

describe('a fence on a sublist marker line leaves the list for the line below', () => {
  it.each([
    ['a closed code fence', ['  - ```', '    x', '    ```'], '<ul><li><pre><code>x\n</code></pre></li></ul>'],
    ['a closed tilde fence', ['  - ~~~', '    x', '    ~~~'], '<ul><li><pre><code>x\n</code></pre></li></ul>'],
    ['an ordered marker', ['  1. ```', '     x', '     ```'], '<ol><li><pre><code>x\n</code></pre></li></ol>'],
    ['a fence with no closer', ['  - ```', '    x'], '<ul><li><pre><code>x\n</code></pre></li></ul>'],
    ['a blank above the sublist', ['', '  - ```', '    x', '    ```'], '<ul><li><pre><code>x\n</code></pre></li></ul>'],
  ])('%s', (_name, body, sublist) => {
    expect(read(lines('- a', ...body, 'tail'))).toBe(`<ul><li>a\n${sublist}</li></ul><p>tail</p>`)
  })

  it('folds the line into a paragraph the sublist opens after the fence', () => {
    expect(read(lines('- a', `  - ${FENCE}`, '    x', `    ${FENCE}`, '    y', 'tail'))).toBe(
      '<ul><li>a\n<ul><li><pre><code>x\n</code></pre>\ny\ntail\n</li></ul></li></ul>',
    )
  })
})

describe('an unmatched comment fence below the content column ends the item', () => {
  it.each([
    ['a longer run at the column', ['  %%%%', '%%%']],
    ['a line comment at the column', ['  %% k', '%%%']],
    ['a run that closed before it', ['  %%%%', '  x', '  %%%%', '%%%']],
  ])('%s', (_name, body) => {
    expect(read(lines('- a', ...body, '  x'))).toBe('<ul><li>a</li></ul><p>x</p>')
  })

  it('keeps a run that closes the span the item holds', () => {
    expect(read(lines('- a', '  %%%', '%%%', '  x'))).toBe('<ul><li>a\nx\n</li></ul>')
    expect(read(lines('- a', '  %%%%', '%%%%', '  x'))).toBe('<ul><li>a\nx\n</li></ul>')
  })
})

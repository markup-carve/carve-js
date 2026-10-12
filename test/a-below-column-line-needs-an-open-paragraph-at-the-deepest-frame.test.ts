import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

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

  it('keeps a marker-shaped line in a literal line block inline, so the line below continues it', () => {
    expect(read(lines('- ::: |', `  - ${FENCE}`, 'tail'))).toBe(
      '<ul><li><div class="line-block"><p>- <code>\ntail</code></p></div></li></ul>',
    )
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


describe('a marker-line fence preserves the deepest paragraph state at every depth', () => {
  for (const depth of [2, 3]) {
    for (const fence of ['```', '~~~']) {
      for (const marker of ['-', '1.']) {
        for (const quote of ['', '> ']) {
          it(`closes depth ${depth} with ${marker} ${fence} under ${quote || 'no quote'}`, () => {
            const width = marker.length + 1
            const tag = marker === '-' ? 'ul' : 'ol'
            const parents = ['a', 'b', 'c'].slice(0, depth)
            const source = lines(
              ...parents.map((text, level) => `${quote}${' '.repeat(level * width)}${marker} ${text}`),
              `${quote}${' '.repeat(depth * width)}${marker} ${fence}`,
              `${quote}${' '.repeat((depth + 1) * width)}x`,
              `${quote}${' '.repeat((depth + 1) * width)}${fence}`,
              'tail',
            )
            const list = parents.map(text => `<${tag}><li>${text}\n`).join('') +
              `<${tag}><li><pre><code>x\n</code></pre></li></${tag}>` +
              `</li></${tag}>`.repeat(depth)
            expect(read(source)).toBe(`${quote ? `<blockquote>${list}</blockquote>` : list}<p>tail</p>`)
          })
        }
      }
    }
  }

  it('continues the deepest prose paragraph', () => {
    expect(read(lines('- a', '  - b', '    - c', 'tail'))).toBe(
      '<ul><li>a\n<ul><li>b\n<ul><li>c\ntail</li></ul></li></ul></li></ul>',
    )
  })

  for (const depth of [2, 3, 4]) {
    for (const fence of ['```', '~~~']) {
      for (const marker of ['-', '1.']) {
        for (const quote of ['', '> ']) {
          for (const tail of ['tail', ' tail']) {
            for (const payload of [['x'], ['x', 'more']]) {
              it(`ends depth ${depth} with unclosed ${marker} ${fence}, quote ${quote}, tail ${tail}, payload ${payload.length}`, () => {
                const width = marker.length + 1
                const tag = marker === '-' ? 'ul' : 'ol'
                const parents = ['a', 'b', 'c', 'd'].slice(0, depth)
                const source = lines(
                  ...parents.map((text, level) => `${quote}${' '.repeat(level * width)}${marker} ${text}`),
                  `${quote}${' '.repeat(depth * width)}${marker} ${fence}`,
                  ...payload.map(text => `${quote}${' '.repeat((depth + 1) * width)}${text}`),
                  tail,
                )
                const list = parents.map(text => `<${tag}><li>${text}\n`).join('') +
                  `<${tag}><li><pre><code>${payload.join('\n')}\n</code></pre></li></${tag}>` +
                  `</li></${tag}>`.repeat(depth)
                expect(read(source)).toBe(`${quote ? `<blockquote>${list}</blockquote>` : list}<p>tail</p>`)
              })
            }
          }
        }
      }
    }
  }

  it('continues prose opened after the deepest fence', () => {
    expect(read(lines('- a', '  - b', `    - ${FENCE}`, '      x', `      ${FENCE}`, '      more', 'tail'))).toBe(
      '<ul><li>a\n<ul><li>b\n<ul><li><pre><code>x\n</code></pre>\nmore\ntail\n</li></ul></li></ul></li></ul>',
    )
  })

  it.each([true, false])('bounds repeated depth-3 marker-line fences with closer %s', closed => {
    const previous = layoutWork.on
    try {
      const rows = [64, 128, 256].map(count => {
        const source = lines('- a', '  - b', `    - ${FENCE}`, '      x', ...(closed ? [`      ${FENCE}`] : []), 'tail', '').repeat(count)
        layoutWork.reset()
        layoutWork.on = true
        const html = read(source)
        expect(html.match(/<pre>/g)?.length).toBe(count)
        expect(html.match(/<\/ul><p>tail<\/p>/g)?.length).toBe(count)
        const work = layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines
        expect(work).toBeLessThanOrEqual(source.length * 64)
        return work
      })
      expect(rows[1]!).toBeLessThanOrEqual(rows[0]! * 2.5)
      expect(rows[2]!).toBeLessThanOrEqual(rows[1]! * 2.5)
    } finally {
      layoutWork.on = previous
      layoutWork.reset()
    }
  })
})

it('keeps a marker-shaped fence line in descendant code payload', () => {
  const source = '- - ```\n    - ```\n\ntail\n'
  for (const positions of [false, true]) {
    const html = renderHtml(parse(source, { positions }))
    expect(html.match(/<code>([\s\S]*?)<\/code>/)?.[1]).toBe('- ```\n')
    expect(normalized(html)).toBe('<ul><li><ul><li><pre><code>- ```\n</code></pre></li></ul></li></ul><p>tail</p>')
  }
})

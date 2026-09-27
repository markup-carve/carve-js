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

  it('keeps the heading inside a marker-line term description', () => {
    expect(flat('* :: c\n  : d\n    # H\n')).toBe(
      '<ul><li><dl><dt>c</dt><dd><p>d</p><h1 id="H">H</h1></dd></dl></li></ul>',
    )
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

  it.each(['# H', '```\n   body\n   ```'])('reports folded task-term blocks: %s', (opener) => {
    expect(reports(`- [x] :: c\n   ${opener}\n`)).toMatchObject([{ line: 2, column: 4 }])
    expect(reports(`> - [ ] :: c\n>    ${opener.replaceAll('\n', '\n> ')}\n`)).toMatchObject([{ line: 2, column: 6 }])
    expect(reports('- [x] :: c\n  # H\n')).toEqual([])
  })

  it('reports through a carriage return or a byte order mark', () => {
    expect(reports(':: c\r  # H\r')).toMatchObject([{ line: 2, column: 3 }])
    expect(reports('\uFEFF:: c\n # H\n')).toMatchObject([{ line: 2, column: 2 }])
  })

  it('stays quiet inside a multi-line code span', () => {
    expect(reports(':: a\n  `code\n  # H\n  end`\n')).toEqual([])
    expect(reports(':: *`code\n  # H\n  end`*\n')).toEqual([])
    expect(lintCarve('- item\n\n  :: a\n    `code\n    # H\n    end`\n')).toEqual([])
  })

  it('stays quiet for plain continuation text, list markers, and openers that open', () => {
    expect(reports(':: c\n  more text\n')).toEqual([])
    expect(reports(':: c\n  - x\n')).toEqual([])
    expect(reports(':: c\n# H\n')).toEqual([])
    expect(reports(':: a\n: b\n  :: c\n  # H\n')).toEqual([])
  })
})

describe('a comment or a definition under a term', () => {
  it('keeps a comment past the column invisible and the term open', () => {
    expect(flat(':: c\n  %% note\n  more\n')).toBe('<dl><dt>cmore</dt></dl>')
    expect(flat(':: c\n  %%%\n  hidden\n  %%%\n  more\n')).toBe('<dl><dt>cmore</dt></dl>')
    expect(flat(':: a\n: b\n  :: c\n    %% note\n    # H\n')).toBe(
      '<dl><dt>a</dt><dd><p>b</p><dl><dt>c# H</dt></dl></dd></dl>',
    )
  })

  it('ends the term at a comment at the container column', () => {
    expect(flat(':: c\n%% note\nmore\n')).toBe('<dl><dt>c</dt></dl><p>more</p>')
  })

  it('folds a definition past the column as text, and registers one at the column', () => {
    expect(flat('[t][r]\n\n:: a\n: b\n  :: c\n    [r]: /u\n')).toBe(
      '<p>[t][r]</p><dl><dt>a</dt><dd><p>b</p><dl><dt>c[r]: /u</dt></dl></dd></dl>',
    )
    expect(flat('x[^n]\n\n- item\n\n  :: c\n    [^n]: y\n')).toBe(
      '<p>x[^n]</p><ul><li>item<dl><dt>c[^n]: y</dt></dl></li></ul>',
    )
    expect(flat('[t][r]\n\n:: a\n: b\n  :: c\n  [r]: /u\n')).toBe(
      '<p><a href="/u">t</a></p><dl><dt>a</dt><dd><p>b</p><dl><dt>c</dt></dl></dd></dl>',
    )
  })

  it.each([
    ['bullet', '- :: c', '    '],
    ['ordered', '1. :: c', '     '],
    ['task', '- [x] :: c', '    '],
    ['nested bullet', '- - :: c', '      '],
    ['quoted bullet', '> - :: c', '>     '],
    ['quote inside a bullet', '- > :: c', '  >   '],
  ])('folds definitions under a term on its %s marker line', (_name, lead, indent) => {
    const source = `[t][r] x[^n]\n\n${lead}\n${indent}[r]: /u\n${indent}[^n]: body\n`
    const html = carveToHtml(source)
    expect(html).toContain('<p>[t][r] x[^n]</p>')
    expect(html).toContain('[r]: /u')
    expect(html).toContain('[^n]: body')
    const once = renderCarve(parse(source))
    expect(carveToHtml(once)).toBe(html)
    expect(renderCarve(parse(once))).toBe(once)
  })

  it('keeps inline content from reaching across a folded comment', () => {
    expect(carveToHtml(':: a `code\n  %% note\n  end`\n')).toBe(
      '<dl>\n  <dt>a <code>code</code>\n\n  end<code></code></dt>\n</dl>',
    )
  })

  it('reads a comment fence body as opaque when deciding what a term folds', () => {
    // A `::` inside a comment opens no term, so the definition after it registers.
    expect(flat('[t][r]\n\n:: a\n: b\n  %%%\n  :: fake\n    %%%\n    [r]: /u\n')).toBe(
      '<p><a href="/u">t</a></p><dl><dt>a</dt><dd>b</dd></dl>',
    )
    // Nor does a `::` inside a code fence.
    expect(flat('[t][r]\n\n```\n:: fake\n  %%%\n```\n[r]: /u\n%%%\n')).toBe(
      '<p><a href="/u">t</a></p><pre><code>:: fake\n  %%%\n</code></pre>'.replace(/\n\s*/g, ''),
    )
    // A blank line inside a folded comment does not end the term.
    expect(flat('[t][r]\n\n:: a\n: b\n  :: c\n    %%%\n\n    hidden\n    %%%\n    [r]: /u\n')).toBe(
      '<p>[t][r]</p><dl><dt>a</dt><dd><p>b</p><dl><dt>c[r]: /u</dt></dl></dd></dl>',
    )
  })

  it('formats a folded comment back to itself', () => {
    for (const source of [
      ':: c\n  %% note\n  more\n',
      ':: a\n: b\n  :: c\n    %%%\n    x\n    %%%\n    # H\n',
      // A line comment whose text starts with `%` must not become a fence.
      ':: c\n  %% % note\n  visible\n  %% %\n  more\n',
      // Consecutive comments stay in the term, with no blank line between.
      ':: c\n  %% one\n  %% two\n: def\n',
      ':: c\n  %%%\n  x\n  %%%\n  %% two\n  more\n',
    ]) {
      const once = renderCarve(parse(source))
      expect(carveToHtml(once)).toBe(carveToHtml(source))
      expect(renderCarve(parse(once))).toBe(once)
    }
  })
})

describe('a term on a list marker line', () => {
  it('folds what lies past the item content column', () => {
    expect(flat('- :: c\n    # H\n')).toBe('<ul><li><dl><dt>c# H</dt></dl></li></ul>')
    expect(flat('1. :: c\n     ::: note\n     body\n     :::\n')).toBe('<ol><li><dl><dt>c::: notebody:::</dt></dl></li></ol>')
    expect(flat('- :: c\n    %% note\n    more\n')).toBe('<ul><li><dl><dt>cmore</dt></dl></li></ul>')
    expect(flat('[t][r]\n\n- :: c\n    [r]: /u\n')).toBe('<p>[t][r]</p><ul><li><dl><dt>c[r]: /u</dt></dl></li></ul>')
  })

  it('opens at the item content column', () => {
    expect(flat('- :: c\n  # H\n')).toBe('<ul><li><dl><dt>c</dt></dl><h1 id="H">H</h1></li></ul>')
  })
})

describe('a quote marker past the term column', () => {
  it('is term text and keeps the term open', () => {
    expect(flat('[t][r]\n\n:: a\n: b\n  :: c\n    > text\n    [r]: /u\n')).toBe(
      '<p>[t][r]</p><dl><dt>a</dt><dd><p>b</p><dl><dt>c&gt; text[r]: /u</dt></dl></dd></dl>',
    )
  })
})

describe('a term on a description marker line', () => {
  it('folds a definition past its column as text', () => {
    expect(flat('[t][r]\n\n:: a\n: :: b\n    [r]: /u\n')).toBe(
      '<p>[t][r]</p><dl><dt>a</dt><dd><dl><dt>b[r]: /u</dt></dl></dd></dl>',
    )
  })

  it('writes an authored private-use character back unchanged', () => {
    const source = ':: \uE0FD\n'
    expect(renderCarve(parse(source))).toBe(source)
  })
})


import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'

const conv = (md: string) => markdownToCarve(md)

describe('markdownToCarve — inline construct mapping', () => {
  it('converts Markdown emphasis *italic* to Carve /italic/', () => {
    expect(conv('an *italic* word')).toBe('an /italic/ word')
  })

  it('converts Markdown emphasis _italic_ to Carve /italic/ (underline trap)', () => {
    // The critical bug a naive port hits: _x_ is emphasis in Markdown but
    // underline in Carve, so it MUST become /x/, never stay _x_.
    expect(conv('an _italic_ word')).toBe('an /italic/ word')
  })

  it('converts Markdown strong **bold** to Carve *bold*', () => {
    expect(conv('a **bold** word')).toBe('a *bold* word')
  })

  it('converts Markdown strong __bold__ to Carve *bold*', () => {
    expect(conv('a __bold__ word')).toBe('a *bold* word')
  })

  it('converts ***bold italic*** to Carve /*bold italic*/', () => {
    expect(conv('a ***strong em*** word')).toBe('a /*strong em*/ word')
  })

  it('leaves space-flanked asterisks literal (arithmetic 2 * 3 * 4)', () => {
    expect(conv('2 * 3 * 4')).toBe('2 * 3 * 4')
  })

  it('leaves intraword asterisk emphasis literal (not expressible in Carve)', () => {
    // Carve `/` cannot open/close intraword, so `foo*bar*baz` is left as-is
    // rather than emitting literal-slash garbage.
    expect(conv('foo*bar*baz')).toBe('foo*bar*baz')
  })

  it('converts ___bold italic___ to Carve /*bold italic*/', () => {
    expect(conv('a ___strong em___ word')).toBe('a /*strong em*/ word')
  })

  it('converts **bold with *italic* inside** to *bold with /italic/ inside*', () => {
    expect(conv('**outer *inner* end**')).toBe('*outer /inner/ end*')
  })

  it('converts emphasis nested inside __strong__', () => {
    expect(conv('__outer _inner_ end__')).toBe('*outer /inner/ end*')
  })

  it('converts emphasis nested inside ***bold italic***', () => {
    expect(conv('***outer _inner_ end***')).toBe('/*outer /inner/ end*/')
  })

  it('converts Markdown ~~strike~~ to Carve ~strike~', () => {
    expect(conv('a ~~gone~~ word')).toBe('a ~gone~ word')
  })

  it('converts ==highlight== to a single = (Carve highlight)', () => {
    expect(conv('a ==hot== word')).toBe('a =hot= word')
  })

  it('leaves ^superscript^ unchanged (same in Carve)', () => {
    expect(conv('x^2^ end')).toBe('x^2^ end')
  })

  it('converts inline math $x$ to $`x`', () => {
    expect(conv('value $a+b$ here')).toBe('value $`a+b` here')
  })

  it('converts display math $$x$$ to $$`x`', () => {
    expect(conv('$$a+b$$')).toBe('$$`a+b`')
  })

  it('does not treat currency $5 as math', () => {
    expect(conv('costs $5 today')).toBe('costs $5 today')
  })

  it('does not treat a currency range $5-$10 as math', () => {
    expect(conv('costs $5-$10 today')).toBe('costs $5-$10 today')
  })

  it('converts digit-starting math like $2+2$', () => {
    expect(conv('so $2+2$ holds')).toBe('so $`2+2` holds')
  })

  it('preserves delimiter characters inside a math span', () => {
    expect(conv('eq $*x*$ end')).toBe('eq $`*x*` end')
  })

  it('leaves intraword underscores literal (foo__bar__baz)', () => {
    expect(conv('foo__bar__baz')).toBe('foo__bar__baz')
  })

  it('does not rewrite delimiters inside a link destination', () => {
    expect(conv('[docs](/api/_v1_/index)')).toBe('[docs](/api/_v1_/index)')
  })

  it('percent-encodes parentheses in a link destination (Carve truncates at `)`)', () => {
    expect(conv('[wiki](https://host/Titan_(moon))')).toBe(
      '[wiki](https://host/Titan_%28moon%29)',
    )
  })

  it('does not rewrite delimiters inside a reference-link definition', () => {
    expect(conv('[docs]: /api/_v1_/index')).toBe('[docs]: /api/_v1_/index')
  })

  it('protects a reference definition with no space after the colon', () => {
    expect(conv('[id]:/api/_v1_/index')).toBe('[id]:/api/_v1_/index')
  })

  it('protects a reference definition whose URL is an http(s) link', () => {
    expect(conv('[id]: https://example.com/_x_')).toBe('[id]: https://example.com/_x_')
  })

  it('still converts inline markup in a footnote definition body', () => {
    expect(conv('[^n]: an *em* note')).toBe('[^n]: an /em/ note')
  })

  it('protects the whole reference definition (label, dest, title)', () => {
    expect(conv('[_id_]: /u "*title*"')).toBe('[_id_]: /u "*title*"')
  })

  it('does not rewrite a reference label at the use site', () => {
    expect(conv('[link][_id_]')).toBe('[link][_id_]')
  })

  it('still converts emphasis in link text', () => {
    expect(conv('[*hi*](/u)')).toBe('[/hi/](/u)')
  })

  it('does not rewrite delimiters inside an autolink', () => {
    expect(conv('<https://example.com/_v1_/index>')).toBe(
      '<https://example.com/_v1_/index>',
    )
  })

  it('does not rewrite delimiters inside a bare URL', () => {
    expect(conv('see https://example.com/api/_v1_/index here')).toBe(
      'see https://example.com/api/_v1_/index here',
    )
  })

  it('does not convert delimiters inside image alt text (raw in Carve)', () => {
    expect(conv('![*logo*](/x.png)')).toBe('![*logo*](/x.png)')
  })

  it('protects image alt text containing nested brackets', () => {
    expect(conv('![*logo* [small]](/x.png)')).toBe('![*logo* [small]](/x.png)')
  })

  it('normalizes an extended fence info string and keeps the block as code', () => {
    // Carve recognizes a single language token, so a Markdown fence like
    // ```js title="demo" is normalized to ```js (keeping it a code block) and
    // its body delimiters are left untouched.
    const md = ['```js title="demo"', '*a*', '```'].join('\n')
    expect(conv(md)).toBe(['```js', '*a*', '```'].join('\n'))
  })

  it('preserves a punctuated fence language like c++', () => {
    const md = ['```c++', '*a*', '```'].join('\n')
    expect(conv(md)).toBe(md)
  })

  it('emits the canonical no-space fence opener from a spaced one', () => {
    // ``` php (space) is accepted on input but normalized to ```php on output.
    const md = ['``` php', '*a*', '```'].join('\n')
    expect(conv(md)).toBe(['```php', '*a*', '```'].join('\n'))
  })
})

describe('markdownToCarve — HTML inline tags', () => {
  it('converts <em>/<i> to /x/', () => {
    expect(conv('<em>a</em> <i>b</i>')).toBe('/a/ /b/')
  })

  it('converts <strong>/<b> to *x*', () => {
    expect(conv('<strong>a</strong> <b>b</b>')).toBe('*a* *b*')
  })

  it('converts <mark> to the forced highlight {=x=}', () => {
    expect(conv('<mark>hot</mark>')).toBe('{=hot=}')
  })

  it('converts <sub> to the forced subscript {,x,} (renders intraword)', () => {
    expect(conv('H<sub>2</sub>O')).toBe('H{,2,}O')
  })

  it('converts <sup> to the forced superscript {^x^} (renders intraword)', () => {
    expect(conv('x<sup>2</sup>')).toBe('x{^2^}')
  })

  it('converts <del>/<s> to ~x~', () => {
    expect(conv('<del>a</del> <s>b</s>')).toBe('~a~ ~b~')
  })

  it('converts <code> to `x`', () => {
    expect(conv('<code>f()</code>')).toBe('`f()`')
  })
})

describe('markdownToCarve — code protection', () => {
  it('does not convert delimiters inside inline code', () => {
    expect(conv('use `a *b* _c_` here')).toBe('use `a *b* _c_` here')
  })

  it('does not convert inside fenced code blocks', () => {
    const md = ['```js', 'const x = *a* + _b_', '```'].join('\n')
    expect(conv(md)).toBe(md)
  })
})

describe('markdownToCarve — block spacing', () => {
  it('inserts a blank line before a heading following text', () => {
    expect(conv('text\n# Heading')).toBe('text\n\n# Heading')
  })

  it('strips an optional ATX closing marker', () => {
    expect(conv('## Title ##')).toBe('## Title')
  })

  it('keeps a trailing hash that is not a closing marker', () => {
    expect(conv('# C#')).toBe('# C#')
  })

  it('converts a setext === heading to an ATX h1', () => {
    expect(conv('Title\n===')).toBe('# Title')
  })

  it('converts a setext --- heading to an ATX h2', () => {
    expect(conv('Subtitle\n---')).toBe('## Subtitle')
  })

  it('inserts a blank line after a heading before text', () => {
    expect(conv('# Heading\ntext')).toBe('# Heading\n\ntext')
  })

  it('inserts a blank line before a top-level list following text', () => {
    expect(conv('text\n- item')).toBe('text\n\n- item')
  })

  it('inserts a blank line before a `1)` ordered list following text', () => {
    expect(conv('text\n1) item')).toBe('text\n\n1) item')
  })

  it('separates a 1-3 space indented top-level list after text (Carve handles the indent)', () => {
    expect(conv('text\n  - item')).toBe('text\n\n  - item')
  })

  it('preserves indented sibling list items', () => {
    expect(conv('  - one\n  - two')).toBe('  - one\n  - two')
  })

  it('keeps an indented blockquote inside a list item (no dedent/blank)', () => {
    expect(conv('- item\n  > quote')).toBe('- item\n  > quote')
  })

  it('does not turn a non-1 ordered continuation into a list', () => {
    // CommonMark: an ordered marker other than 1 cannot interrupt a paragraph.
    expect(conv('Intro\n2024. was busy')).toBe('Intro\n2024. was busy')
  })

  it('treats a leading-zero `01.` marker as start 1 (interrupts paragraph)', () => {
    expect(conv('Intro\n01. item')).toBe('Intro\n\n01. item')
  })

  it('inserts a blank line before a blockquote following text', () => {
    expect(conv('text\n> quote')).toBe('text\n\n> quote')
  })

  it('collapses 3+ consecutive blank lines to 2', () => {
    expect(conv('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('preserves a tight nested list (no blank line inserted before child)', () => {
    // Carve parses `- parent\n  - child` as a nested list by indentation
    // alone (corpus 05-lists-9); inserting a blank would make it loose.
    expect(conv('- parent\n  - child')).toBe('- parent\n  - child')
  })
})

describe('markdownToCarve — code protection edge cases', () => {
  it('does not convert inside an indented fenced code block', () => {
    const md = ['  ```', '  const x = *a* + _b_', '  ```'].join('\n')
    expect(conv(md)).toBe(md)
  })

  it('does not convert inside a multi-backtick code span', () => {
    expect(conv('use ``a `*b*` c`` here')).toBe('use ``a `*b*` c`` here')
  })

  it('does not close a long fence on a shorter inner run', () => {
    const md = ['````', '```', '*a* _b_', '````'].join('\n')
    expect(conv(md)).toBe(md)
  })

  it('does not close a code span on the suffix of a longer inner run', () => {
    expect(conv('``a ``` *b*``')).toBe('``a ``` *b*``')
  })

  it('leaves literal placeholder-looking text intact', () => {
    // The internal restore step must not corrupt ordinary text that happens
    // to resemble a placeholder token.
    expect(conv('keep P0 and S0 tokens')).toBe('keep P0 and S0 tokens')
  })

  it('leaves backslash-escaped delimiters literal', () => {
    expect(conv('\\*literal\\* and \\_keep\\_')).toBe('\\*literal\\* and \\_keep\\_')
  })

  it('does not convert delimiters inside <code>', () => {
    expect(conv('<code>*x* _y_</code>')).toBe('`*x* _y_`')
  })
})

describe('markdownToCarve — more block spacing', () => {
  it('inserts a blank line between a blockquote and following text', () => {
    expect(conv('> quote\ntext')).toBe('> quote\n\ntext')
  })

  it('dedents a 1-3 space indented heading to column 1', () => {
    expect(conv('  # Title')).toBe('# Title')
  })

  it('dedents a 1-3 space indented blockquote to column 1', () => {
    expect(conv('  > quote')).toBe('> quote')
  })

  it('leaves an already well-spaced document unchanged', () => {
    const md = '# Title\n\nA /para/ here.\n\n- one\n- two\n'
    expect(conv(md)).toBe('# Title\n\nA /para/ here.\n\n- one\n- two\n')
  })
})

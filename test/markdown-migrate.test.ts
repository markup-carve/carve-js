import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

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

  it('converts ^superscript^ to the braced {^x^} (Carve has no bare superscript)', () => {
    expect(conv('x^2^ end')).toBe('x{^2^} end')
    expect(conv('a ^up^ end')).toBe('a {^up^} end')
  })

  it('does not pair footnote-reference carets into a superscript span', () => {
    expect(conv('a [^x] b [^y]')).toBe('a [^x] b [^y]')
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

  it('preserves a MIME-style fence language like text/html', () => {
    const md = ['```text/html', '<b>x</b>', '```'].join('\n')
    expect(conv(md)).toBe(md)
  })

  it('emits the canonical no-space fence opener from a spaced one', () => {
    // ``` php (space) is accepted on input but normalized to ```php on output.
    const md = ['``` php', '*a*', '```'].join('\n')
    expect(conv(md)).toBe(['```php', '*a*', '```'].join('\n'))
  })
})

describe('markdownToCarve — multiline paragraph inline mapping', () => {
  it('converts strong spanning a line break without changing the break', () => {
    const carve = conv('a **b\nc** d')
    expect(carve).toBe('a *b\nc* d')
    expect(carveToHtml(carve)).toBe('<p>a <strong>b\nc</strong> d</p>')
  })

  it('converts emphasis spanning a line break without becoming Carve strong', () => {
    const carve = conv('a *it\nb* c')
    expect(carve).toBe('a /it\nb/ c')
    expect(carveToHtml(carve)).toBe('<p>a <em>it\nb</em> c</p>')
  })

  it('converts strikethrough spanning a line break', () => {
    const carve = conv('a ~~s\nt~~ c')
    expect(carve).toBe('a ~s\nt~ c')
    expect(carveToHtml(carve)).toBe('<p>a <s>s\nt</s> c</p>')
  })

  it('does not convert emphasis across a blank line', () => {
    const carve = conv('a *it\n\nb* c')
    expect(carve).toBe('a *it\n\nb* c')
    expect(carveToHtml(carve)).toBe('<p>a *it</p>\n<p>b* c</p>')
  })

  it('keeps a code span spanning a line break verbatim', () => {
    const carve = conv('a `*x\n_y_` b')
    expect(carve).toBe('a `*x\n_y_` b')
    expect(carveToHtml(carve)).toBe('<p>a <code>*x\n_y_</code> b</p>')
  })

  it('keeps fenced code with multiline delimiter pairs untouched', () => {
    const md = ['```', 'a **b', 'c** d', '```'].join('\n')
    expect(conv(md)).toBe(md)
    expect(carveToHtml(conv(md))).toBe('<pre><code>a **b\nc** d\n</code></pre>')
  })

  it('converts a link whose label wraps across a line', () => {
    const carve = conv('[a\nb](/u)')
    expect(carve).toBe('[a\nb](/u)')
    expect(carveToHtml(carve)).toBe('<p><a href="/u">a\nb</a></p>')
  })

  it('does not let emphasis leak across table row boundaries', () => {
    const md = ['| *a | b |', '| c | d* |', '| **x** | *y* |', '| **z** | *w* |'].join('\n')
    const carve = ['| *a | b |', '| c | d* |', '| *x* | /y/ |', '| *z* | /w/ |'].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toContain('<tr><td><strong>x</strong></td><td><em>y</em></td></tr>')
  })

  it('preserves line count and leading whitespace in a multiline paragraph', () => {
    const md = '  a **b\n    c** d\n\t*e\n\tf*'
    const carve = conv(md)
    expect(carve).toBe('  a *b\n    c* d\n\t/e\n\tf/')
    expect(carve.split('\n')).toHaveLength(md.split('\n').length)
    expect(carve.split('\n').map((line) => line.match(/^[ \t]*/)?.[0])).toEqual(
      md.split('\n').map((line) => line.match(/^[ \t]*/)?.[0]),
    )
  })
})

describe('markdownToCarve — prefixed multiline inline mapping', () => {
  it('converts strong across a wrapped list item without changing indentation', () => {
    const md = '- **strong\n  text** end'
    const carve = conv(md)
    expect(carve).toBe('- *strong\n  text* end')
    expect(carveToHtml(carve)).toContain('<strong>strong\ntext</strong> end')
  })

  it('converts wrapped list-item Markdown emphasis to Carve emphasis', () => {
    const md = '- *italic\n  text* end'
    const carve = conv(md)
    expect(carve).toBe('- /italic\n  text/ end')
    expect(carveToHtml(carve)).toContain('<em>italic\ntext</em> end')
  })

  it('keeps adjacent list items as independent inline runs', () => {
    const md = ['- **open', '- **closed**'].join('\n')
    const carve = conv(md)
    expect(carve).toBe(['- **open', '- *closed*'].join('\n'))
    expect(carveToHtml(carve)).toContain('<li>**open</li>')
    expect(carveToHtml(carve)).toContain('<li><strong>closed</strong></li>')
  })

  it('keeps nested list items as their own inline runs', () => {
    const md = ['- parent **only**', '  - nested **wrap', '    here**'].join('\n')
    const carve = conv(md)
    expect(carve).toBe(['- parent *only*', '  - nested *wrap', '    here*'].join('\n'))
    expect(carveToHtml(carve)).toContain('<li>parent <strong>only</strong>')
    expect(carveToHtml(carve)).toContain('<li>nested <strong>wrap\nhere</strong></li>')
  })

  it('converts wrapped blockquote emphasis while preserving quote prefixes', () => {
    const md = ['> **quoted', '> body** end'].join('\n')
    const carve = conv(md)
    expect(carve).toBe(['> *quoted', '> body* end'].join('\n'))
    expect(carveToHtml(carve)).toBe('<blockquote><p><strong>quoted\nbody</strong> end</p></blockquote>')
  })

  it('leaves a fenced code block inside a list item untouched', () => {
    const md = ['- item', '  ```', '  **no**', '  ```'].join('\n')
    const carve = conv(md)
    expect(carve).toBe(['- item', '', '  ```', '  **no**', '  ```'].join('\n'))
    expect(carveToHtml(carve)).toContain('<pre><code>**no**\n</code></pre>')
  })

  it('round-trips the wrapped accumulation documentation snippet', () => {
    const md = [
      '- *Accumulation:* consecutive attribute lines merge in source order —',
      '  `id` last-wins, `key=value` last-wins per key, and **classes',
      '  accumulate** (no de-duplication):',
    ].join('\n')
    const carve = [
      '- /Accumulation:/ consecutive attribute lines merge in source order —',
      '  `id` last-wins, `key=value` last-wins per key, and *classes',
      '  accumulate* (no de-duplication):',
    ].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toContain(
      '<em>Accumulation:</em> consecutive attribute lines merge in source order',
    )
    expect(carveToHtml(carve)).toContain('<strong>classes\naccumulate</strong>')
  })

  it('round-trips the wrapped back-links documentation snippet', () => {
    const md = [
      '- *Back-links are mandated.* The anchor sits on the **per-key rendered',
      '  item**, not on the `citation-group` element, ...',
    ].join('\n')
    const carve = [
      '- /Back-links are mandated./ The anchor sits on the *per-key rendered',
      '  item*, not on the `citation-group` element, ...',
    ].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toContain('<em>Back-links are mandated.</em>')
    expect(carveToHtml(carve)).toContain('<strong>per-key rendered\nitem</strong>')
  })
})

describe('markdownToCarve — HTML inline tags', () => {
  it('converts <em>/<i> to /x/', () => {
    expect(conv('<em>a</em> <i>b</i>')).toBe('/a/ /b/')
  })

  it('converts <strong>/<b> to *x*', () => {
    expect(conv('<strong>a</strong> <b>b</b>')).toBe('*a* *b*')
  })

  it('converts a standalone <mark> to the bare highlight =x=', () => {
    expect(conv('a <mark>hot</mark> day')).toBe('a =hot= day')
  })

  it('converts <sup>/<sub> to the braced forms (Carve has no bare sup/sub)', () => {
    expect(conv('a <sup>up</sup> and <sub>down</sub>')).toBe('a {^up^} and {,down,}')
  })

  it('brace-forces highlight when intraword; sub/sup are always braced', () => {
    expect(conv('H<sub>2</sub>O')).toBe('H{,2,}O')
    expect(conv('x<sup>2</sup>')).toBe('x{^2^}')
    expect(conv('foo<mark>bar</mark>baz')).toBe('foo{=bar=}baz')
    expect(conv('a <mark>hot</mark> day')).toBe('a =hot= day')
  })

  it('always brace-forces <ins> (Carve has no bare + delimiter)', () => {
    expect(conv('a <ins>new</ins> note')).toBe('a {+new+} note')
    expect(conv('foo<ins>bar</ins>baz')).toBe('foo{+bar+}baz')
  })

  it('converts <del>/<s> to ~x~', () => {
    expect(conv('<del>a</del> <s>b</s>')).toBe('~a~ ~b~')
  })

  it('converts <code> to `x`', () => {
    expect(conv('<code>f()</code>')).toBe('`f()`')
  })
})

describe('markdownToCarve — raw HTML migration', () => {
  it('preserves a multi-line HTML block as raw html', () => {
    const md = ['<div class="x">', '  <span>hi</span>', '</div>', '', 'after'].join('\n')
    const carve = ['```=html', '<div class="x">', '  <span>hi</span>', '</div>', '```', '', 'after'].join(
      '\n',
    )
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toBe('<div class="x">\n  <span>hi</span>\n</div>\n<p>after</p>')
  })

  it('preserves an HTML comment block', () => {
    const md = ['<!-- keep "this"', 'and `that` -->', '', 'after'].join('\n')
    const carve = ['```=html', '<!-- keep "this"', 'and `that` -->', '```', '', 'after'].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toBe('<!-- keep "this"\nand `that` -->\n<p>after</p>')
  })

  it('preserves inline HTML in a sentence as raw html', () => {
    const md = 'a <span class="x">hi</span> c'
    const carve = 'a `<span class="x">hi</span>`{=html} c'
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toBe('<p>a <span class="x">hi</span> c</p>')
  })

  it('keeps attributed mappable inline tags as raw html', () => {
    const md = '<b class="x">y</b>'
    const carve = '`<b class="x">y</b>`{=html}'
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toBe('<p><b class="x">y</b></p>')
  })

  it('preserves attributed inline code HTML as raw html', () => {
    const md = 'a <code v-pre>{{ x }}</code> c'
    const carve = 'a `<code v-pre>{{ x }}</code>`{=html} c'
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toBe('<p>a <code v-pre>{{ x }}</code> c</p>')
  })

  it('preserves inline HTML in a table cell without breaking the table', () => {
    const md = ['| Name | Badge |', '| --- | --- |', '| a | <Badge type="tip" /> |'].join('\n')
    const carve = ['|= Name |= Badge |', '| a | `<Badge type="tip" />`{=html} |'].join('\n')
    expect(conv(md)).toBe(carve)
    const html = carveToHtml(carve)
    expect(html).toContain('<table>')
    expect(html).toContain('<td><Badge type="tip" /></td>')
  })

  it('converts mappable HTML natively and unknown HTML as raw inside a table row', () => {
    const md = ['| Native | Raw |', '| --- | --- |', '| <b>x</b> | <Badge/> |'].join('\n')
    const carve = ['|= Native |= Raw |', '| *x* | `<Badge/>`{=html} |'].join('\n')
    expect(conv(md)).toBe(carve)
    const html = carveToHtml(carve)
    expect(html).toContain('<td><strong>x</strong></td>')
    expect(html).toContain('<td><Badge/></td>')
  })

  it('uses longer delimiters when raw HTML contains backtick runs', () => {
    const blockMd = ['<div data-run="```">', 'ok', '</div>'].join('\n')
    const blockCarve = ['````=html', '<div data-run="```">', 'ok', '</div>', '````'].join('\n')
    expect(conv(blockMd)).toBe(blockCarve)
    expect(carveToHtml(blockCarve)).toBe('<div data-run="```">\nok\n</div>')

    const inlineMd = 'a <Badge text="``" /> b'
    const inlineCarve = 'a ```<Badge text="``" />```{=html} b'
    expect(conv(inlineMd)).toBe(inlineCarve)
    expect(carveToHtml(inlineCarve)).toBe('<p>a <Badge text="``" /> b</p>')
  })

  it('leaves HTML-looking text inside fenced code blocks untouched', () => {
    const md = ['```', '<div class="x">', '```'].join('\n')
    expect(conv(md)).toBe(md)
    expect(carveToHtml(conv(md))).toBe('<pre><code>&lt;div class="x"&gt;\n</code></pre>')
  })

  it('leaves a bare less-than comparison in prose untouched', () => {
    const md = 'a < b'
    expect(conv(md)).toBe(md)
    expect(carveToHtml(conv(md))).toBe('<p>a &lt; b</p>')
  })

  it('keeps URL and email autolinks as Carve autolinks', () => {
    expect(conv('<https://example.com>')).toBe('<https://example.com>')
    expect(conv('<a@b.com>')).toBe('<a@b.com>')
    expect(carveToHtml(conv('<https://example.com>'))).toBe(
      '<p><a href="https://example.com">https://example.com</a></p>',
    )
    expect(carveToHtml(conv('<a@b.com>'))).toBe('<p><a href="mailto:a@b.com">a@b.com</a></p>')
  })
})

describe('markdownToCarve — GFM tables', () => {
  it('rewrites a header row + delimiter to Carve |= header cells (no delimiter row)', () => {
    const md = ['| Name | Type |', '|---|---|', '| Carve | Markup |'].join('\n')
    expect(conv(md)).toBe(['|= Name |= Type |', '| Carve | Markup |'].join('\n'))
  })

  it('maps GFM column alignment to the |= glued markers (< ~ >)', () => {
    const md = ['| L | C | R |', '| :-- | :--: | --: |', '| a | b | c |'].join('\n')
    expect(conv(md)).toBe(['|=< L |=~ C |=> R |', '| a | b | c |'].join('\n'))
  })

  it('converts inline markup inside header cells', () => {
    const md = ['| **Bold** | _Under_ |', '| --- | --- |', '| x | y |'].join('\n')
    expect(conv(md)).toBe(['|= *Bold* |= /Under/ |', '| x | y |'].join('\n'))
  })

  it('unescapes pipes inside body-row code spans', () => {
    const md = ['| A | B |', '| --- | --- |', '| x | `\\| col \\|` |'].join('\n')
    const carve = ['|= A |= B |', '| x | `| col |` |'].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toContain('<code>| col |</code>')
  })

  it('unescapes pipes inside header-row code spans', () => {
    const md = ['| `\\| col \\|` | B |', '| --- | --- |', '| x | y |'].join('\n')
    const carve = ['|= `| col |` |= B |', '| x | y |'].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toContain('<code>| col |</code>')
  })

  it('keeps escaped pipes outside code spans in table cells', () => {
    const md = ['| A | B |', '| --- | --- |', '| x | a \\| b |'].join('\n')
    const carve = ['|= A |= B |', '| x | a \\| b |'].join('\n')
    expect(conv(md)).toBe(carve)
    expect(carveToHtml(carve)).toContain('<td>a | b</td>')
  })

  it('keeps escaped pipes inside ordinary prose code spans', () => {
    expect(conv('not a table `\\| col \\|`')).toBe('not a table `\\| col \\|`')
  })

  it('keeps escaped pipes inside fenced code blocks', () => {
    const md = ['```', '| a | `\\| b \\|` |', '```'].join('\n')
    expect(conv(md)).toBe(md)
  })

  it('unescapes pipes only inside code spans when a row mixes both forms', () => {
    const md = ['| A | B |', '| --- | --- |', '| a \\| b | `c \\| d` |'].join('\n')
    expect(conv(md)).toBe(['|= A |= B |', '| a \\| b | `c | d` |'].join('\n'))
  })

  it('leaves a pipe-bearing paragraph alone when no delimiter row follows', () => {
    expect(conv('a | b | c')).toBe('a | b | c')
  })

  it('does not treat a column-count mismatch as a table (delimiter not consumed)', () => {
    // `a | b` (2 cols) over `---` (1 col) is not a GFM table; it is a setext
    // h2, so the delimiter must not be eaten into a bogus table.
    expect(conv('a | b\n---')).toBe('## a | b')
  })
})

describe('markdownToCarve — thematic breaks', () => {
  it('normalizes every Markdown thematic-break form to canonical ---', () => {
    for (const md of ['* * *', '- - -', '_ _ _', '***', '___', '---', '----', ' ***', '  ---']) {
      expect(conv(md)).toBe('---')
    }
  })

  it('a normalized break renders as an <hr> after round-trip', () => {
    for (const md of ['* * *', '- - -', '_ _ _', '***']) {
      expect(carveToHtml(conv(md))).toBe('<hr>')
    }
  })

  it('keeps the rule as its own block between paragraphs', () => {
    expect(conv('text\n\n* * *\n\nmore')).toBe('text\n\n---\n\nmore')
  })

  it('a contiguous --- underline stays a setext heading, not a rule', () => {
    // CommonMark: setext wins over a thematic break under a paragraph.
    expect(conv('para\n---')).toBe('## para')
  })

  it('a rule line is not itself consumed as setext heading text', () => {
    // CommonMark: `***\n---` is two thematic breaks, not an h2 titled `***`.
    expect(carveToHtml(conv('***\n---'))).toBe('<hr>\n<hr>')
    expect(carveToHtml(conv('---\n---'))).toBe('<hr>\n<hr>')
  })

  it('a document that opens with a rule does not vanish into frontmatter', () => {
    // `---\n\n---` on line 0 would read as an empty frontmatter fence; the
    // migrator keeps both rules by guarding line 0.
    expect(carveToHtml(conv('***\n\n***'))).toBe('<hr>\n<hr>')
    expect(carveToHtml(conv('* * *\n\n* * *'))).toBe('<hr>\n<hr>')
    expect(carveToHtml(conv('***\n\ntext\n\n***'))).toBe('<hr>\n<p>text</p>\n<hr>')
  })

  it('a bare --- inside a code block cannot close a phantom frontmatter fence', () => {
    // Carve strips frontmatter before block parsing, so a `---   ` line inside a
    // fence would otherwise close a line-0 `---` — the guard keeps the rule and
    // the code block intact.
    const md = ['***', '', '```', '---   ', '```', '', 'text'].join('\n')
    expect(carveToHtml(conv(md))).toBe('<hr>\n<pre><code>---   \n</code></pre>\n<p>text</p>')
  })

  it('normalizes a thematic break wrapped in blockquote markers', () => {
    expect(conv('> * * *')).toBe('> ---')
    expect(conv('> > _ _ _')).toBe('> > ---')
    // Markdown allows up to 3 spaces before the blockquote marker.
    expect(conv('  > * * *')).toBe('> ---')
    expect(carveToHtml(conv('> * * *'))).toBe('<blockquote>\n  <hr>\n</blockquote>')
    expect(carveToHtml(conv('> a\n> ***\n> b'))).toBe(
      '<blockquote>\n  <p>a</p>\n  <hr>\n  <p>b</p>\n</blockquote>',
    )
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
  it('leaves an indented fenced code block opaque, re-basing it to column 0', () => {
    // A document-level fence carries no container, so its 1-3 space Markdown
    // indent is re-based to column 0 (a strict Carve fence opens only there).
    // The sample text stays opaque: `*a*` / `_b_` are not converted.
    const md = ['  ```', '  const x = *a* + _b_', '  ```'].join('\n')
    expect(conv(md)).toBe(['```', 'const x = *a* + _b_', '```'].join('\n'))
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

  it('leaves an already well-spaced document structure unchanged', () => {
    // The slash pair is escaped: `/para/` is prose in Markdown, and only the
    // escaped form renders as the prose it was. The spacing is what this case
    // is about, and that is untouched.
    const md = '# Title\n\nA /para/ here.\n\n- one\n- two\n'
    expect(conv(md)).toBe('# Title\n\nA \\/para/ here.\n\n- one\n- two\n')
  })
})

describe('markdownToCarve — Carve-only inline syntax is literal in Markdown', () => {
  const html = (md: string): string => carveToHtml(conv(md)).trim()

  // CommonMark defines none of these, so they are plain text on the way in.
  // Before this, `a {,y,} b` rendered a subscript and `a %%c%% b` lost its
  // text outright, since `%%` opens a comment.
  it.each([
    ['a {^x^} b', '<p>a {^x^} b</p>'],
    ['a {,x,} b', '<p>a {,x,} b</p>'],
    ['a {=x=} b', '<p>a {=x=} b</p>'],
    ['a {+x+} b', '<p>a {+x+} b</p>'],
    ['a {-x-} b', '<p>a {-x-} b</p>'],
    ['a {~x~} b', '<p>a {~x~} b</p>'],
    ['a {/x/} b', '<p>a {/x/} b</p>'],
    ['a /it/ b', '<p>a /it/ b</p>'],
    ['a =hl= b', '<p>a =hl= b</p>'],
    ['a ~s~ b', '<p>a ~s~ b</p>'],
    ['a %%c%% b', '<p>a %%c%% b</p>'],
    ['%% whole line', '<p>%% whole line</p>'],
    // One pass escapes only the outer brace, and the inner pair would then
    // render as a subscript inside otherwise literal text.
    ['nested {^a{,b,}c^} d', '<p>nested {^a{,b,}c^} d</p>'],
    ['two {^a^} and {,b,} x', '<p>two {^a^} and {,b,} x</p>'],
  ])('keeps %j literal', (md, expected) => {
    expect(html(md)).toBe(expected)
  })

  // Over-escaping is its own defect, so the shapes Carve already leaves alone
  // are asserted rather than assumed. The non-http URLs matter: only http and
  // https are protected before the escape pass, and escaping the second slash
  // of `//` would free the first one to open emphasis.
  it.each([
    'path a/b/c d',
    'and/or maybe',
    '1/2 and 3/4',
    'ratio 16/9',
    'C:/path/to/file',
    'x = y = z',
    'approx ~5 items',
    'a 50% of b',
    'k {a=b} v',
    'c {.cls} d',
    'ftp://x/',
    '//host/path',
    'file:///etc/hosts',
    'a //b// c',
  ])('does not escape %j', (md) => {
    expect(conv(md)).toBe(md)
  })

  it.each([
    ['**b**', '<strong>b</strong>'],
    ['_em_', '<em>em</em>'],
    ['~~s~~', '<s>s</s>'],
    ['==h==', '<mark>h</mark>'],
    ['^sup^', '<sup>sup</sup>'],
    ['<sub>x</sub>', '<sub>x</sub>'],
    ['<ins>x</ins>', '<ins>x</ins>'],
    ['`*x*`', '<code>*x*</code>'],
  ])('still converts %j', (md, expected) => {
    expect(html(md)).toContain(expected)
  })
})

describe('markdownToCarve — sentinel placeholder robustness', () => {
  // Placeholders are NUL-wrapped (`\x00S<n>\x00` / `\x00P<n>\x00`). If such a
  // shape appears in the INPUT with an out-of-range index, the restore must not
  // splice the literal string "undefined" into the output - it keeps the
  // matched text verbatim instead.
  it('does not emit the literal string "undefined" for an injected stash sentinel', () => {
    const out = markdownToCarve('a \x00S5\x00 b')
    expect(out).not.toContain('undefined')
    expect(out).toContain('\x00S5\x00')
  })

  it('does not emit "undefined" for an injected protect sentinel', () => {
    const out = markdownToCarve('a \x00P9\x00 b')
    expect(out).not.toContain('undefined')
    expect(out).toContain('\x00P9\x00')
  })

  it('does not emit "undefined" when both sentinel shapes are injected', () => {
    const out = markdownToCarve('x \x00S5\x00 y \x00P9\x00 z')
    expect(out).not.toContain('undefined')
  })
})

describe('markdownToCarve — frontmatter', () => {
  it('preserves YAML frontmatter verbatim and converts only the body', () => {
    // Frontmatter is opaque metadata that Carve strips before block parsing, so
    // it must survive byte-for-byte. Without the guard the opening `---` reads
    // as a thematic break and the closing one as a setext underline, turning
    // `description: y` into an h2.
    const md = ['---', 'title: X', 'description: Y', '---', '', '# H', '', 'a **bold** word'].join(
      '\n',
    )
    expect(conv(md)).toBe(
      ['---', 'title: X', 'description: Y', '---', '', '# H', '', 'a *bold* word'].join('\n'),
    )
  })

  it('does not rewrite Markdown delimiters inside frontmatter', () => {
    // A YAML value is data, not prose: `**x**` and `_x_` stay exactly as written.
    const md = ['---', 'title: a **bold** and _under_ value', '---', '', 'a **bold** word'].join(
      '\n',
    )
    expect(conv(md)).toBe(
      ['---', 'title: a **bold** and _under_ value', '---', '', 'a *bold* word'].join('\n'),
    )
  })

  it('preserves a format-labeled frontmatter fence', () => {
    const md = ['---toml', 'title = "X"', '---', '', 'text'].join('\n')
    expect(conv(md)).toBe(['---toml', 'title = "X"', '---', '', 'text'].join('\n'))
  })

  it('preserves the lenient spaced form of the format label', () => {
    // The parser accepts `--- toml` as well as `---toml`; the migrator must
    // recognize the same openers or a spaced fence would be shredded.
    const md = ['--- toml', 'title = "X"', '---', '', 'a **bold** word'].join('\n')
    expect(conv(md)).toBe(['--- toml', 'title = "X"', '---', '', 'a *bold* word'].join('\n'))
  })

  it('handles a frontmatter-only document with no body', () => {
    expect(conv('---\ntitle: X\n---')).toBe('---\ntitle: X\n---')
  })

  it('keeps frontmatter out of the rendered body', () => {
    const md = ['---', 'title: X', '---', '', 'text'].join('\n')
    expect(carveToHtml(conv(md))).toBe('<p>text</p>')
  })

  it('an unclosed leading --- is still a thematic break, not frontmatter', () => {
    // No closing fence, so Carve would not read frontmatter either; the rule
    // must survive as a rule.
    expect(carveToHtml(conv('---\n\ntext'))).toBe('<hr>\n<p>text</p>')
  })

  it('an empty --- fence pair stays two thematic breaks', () => {
    // An empty fence carries no metadata, so the CommonMark reading (two rules)
    // is the meaning-preserving one. Guards the existing line-0 rule behavior.
    expect(carveToHtml(conv('---\n---'))).toBe('<hr>\n<hr>')
    expect(carveToHtml(conv('---\n\n---'))).toBe('<hr>\n<hr>')
  })
})

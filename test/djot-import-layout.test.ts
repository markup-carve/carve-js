import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { parse, renderHTML } from '@djot/djot'
import { djotCodePadding, djotInlineLayout } from '../src/djot-block-layout.js'

const blockHtml = (html: string): string =>
  html
    .replace(/<\/?tbody>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/> | </g, (s) => s.trim())
    .trim()

it.each([
  '',
  'tail',
  '[x]',
  '[x](u)',
  '![x](u)',
  '*s*',
  '_e_',
  '`c`',
  '{=m=}',
  '{-d-}',
  '^u^',
  '~d~',
  '<http://a.b>',
  'word',
  "'q'",
  '\\*',
  '\\{',
])('keeps an empty attributed span before %s', (tail) => {
  const source = `[x]{}${tail}\n`
  const converted = djotToCarve(source)
  expect(converted).toContain('[x]{}')
  expect(carveToHtml(converted)).toBe(
    renderHTML(parse(source)).trim().replace('<img alt="x" src="u">', '<img src="u" alt="x">'),
  )
})

it.each(['pre [x]{} post\n', '*[x]{}*\n', '_[x]{}_\n', '[x]{}{}\n', '![x]{}\n'])(
  'keeps an empty attributed span in %s',
  (source) => {
    expect(carveToHtml(djotToCarve(source))).toBe(renderHTML(parse(source)).trim())
  },
)

it.each(['\\[x]{}\n', '[x\\]{}\n', ']{}\n', 'word{}\n', '[x](u){}\n', '*a [b* c]{}\n', '_a [b_ c]{}\n'])(
  'removes empty attributes that do not create a span in %s',
  (source) => {
    expect(djotToCarve(source)).not.toContain('{}')
    expect(carveToHtml(djotToCarve(source))).toBe(renderHTML(parse(source)).trim())
  },
)

it.each(['a', '*a*'])('preserves escaped spaces before a hard break after %s', (prefix) => {
  for (const spaces of ['\\ ', ' \\ ', '\\ \\ ']) {
    const source = `${prefix}${spaces}\\\nb\n`
    expect(djotInlineLayout(source)).toBe(source)
    expect(djotToCarve(source)).toBe(source)
    expect(carveToHtml(djotToCarve(source))).toBe(renderHTML(parse(source)).trim())
  }
})

it.each([
  ['a\\ \\ \n', 'a\\ \\\n'],
  ['a\\  \t\\\nb\n', 'a\\ \\\nb\n'],
  ['a\\\\ \t\\\nb\n', 'a\\\\\\\nb\n'],
  ['a  \t\\\nb\n', 'a\\\nb\n'],
])('trims only unescaped whitespace before a hard break in %s', (source, expected) => {
  expect(djotInlineLayout(source)).toBe(expected)
  expect(carveToHtml(djotToCarve(source))).toBe(renderHTML(parse(source)).trim())
})

it.each(['> a\n# a\n', '# a\n  body\n::: x\n'])('ends paragraph state at the review block boundary in %s', (source) => {
  const converted = djotToCarve(source)
  expect(converted).toBe(source.startsWith('#') ? '# a body\n::: x\n:::\n' : source)
  expect(blockHtml(carveToHtml(converted))).toBe(blockHtml(renderHTML(parse(source))))
})

it.each(['> a', '> > a', '> a\n> b', '- a', '- a\n  b', '1. a'])(
  'starts blocks outside the preceding container in %s',
  (container) => {
    for (const block of ['# h', '## h', '***', '> q', '::: x\nin\n:::', '| t |']) {
      const source = `${container}\n${block}\n`
      expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
    }
  },
)

it.each(['# a\n  body', '## a\nbody'])('keeps blocks after a heading continuation separate in %s', (heading) => {
  for (const block of ['# h', '## h', '***', '- - -', '> q', '- li', '::: x\nin\n:::', '| t |']) {
    const source = `${heading}\n${block}\n`
    expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
  }
})

it.each(['- a\n # h\n', '1. a\n  # h\n'])(
  'keeps a partially indented block marker inside the open item paragraph in %s',
  (source) => {
    expect(djotToCarve(source)).toContain('\\# h')
    expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
  },
)

it.each(['- # h\n  - x\n', '- a\n\n  # h\n  body\n  - x\n'])(
  'starts a nested list after a heading inside the same item in %s',
  (source) => {
    const converted = djotToCarve(source)
    expect(converted).not.toContain('\\- x')
    const html = carveToHtml(converted)
    expect(html).toContain(source.includes('body') ? '<h1 id="h-body">h body</h1>' : '<h1 id="h">h</h1>')
    expect(html.match(/<ul>/g)).toHaveLength(2)
  },
)

it.each(['b. x', 'A) x', 'i. x', 'IV. x'])(
  'keeps a lettered or roman ordered marker after a heading separate: %s',
  (marker) => {
    const source = '# a\n' + marker + '\n'
    expect(djotToCarve(source)).toBe(source)
    const html = carveToHtml(djotToCarve(source))
    expect(html).toContain('<h1>a</h1>')
    expect(html).toContain('<ol')
  },
)

it.each(['text\n## a\n## b\n', '- a\n  # h\n  # x\n', 'para\n1. # h\n# z\n', 'ab. # x\n# y\n'])(
  'keeps heading markers that continue an open paragraph literal in %s',
  (source) => {
    expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
  },
)

it('folds a heading continuation inside a parenthesized ordered item', () => {
  const source = '(1) # h\n    body\n'
  expect(djotToCarve(source)).toBe('1. # h body\n')
  expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
})

it.each(['[x]', '![x]'])('keeps empty attribute groups in a nested %s destination', (label) => {
  expect(djotToCarve(`${label}(a(b{}c))\n`)).toBe(`${label}(a%28b{}c%29)\n`)
})

it('keeps attribute values opaque when references inherit definition attributes', () => {
  const source = '{title=foo}\n[x]: /u\n\n[hi]{title="[x][]"}\n'
  expect(carveToHtml(djotToCarve(source))).toBe('<p><span title="[x][]">hi</span></p>')
})

it('keeps other uses of a definition whose formatted label is written inline', () => {
  const source = '[link _and_ link][] [plain][link and link]\n\n[link and link]: url\n'
  expect(carveToHtml(djotToCarve(source))).toBe(
    '<p><a href="url">link <em>and</em> link</a> <a href="url">plain</a></p>',
  )
})

it('lets the link override every definition attribute key', () => {
  const source = '{.a #a title=a data-extra=x}\n[x]: /u\n\n[x][]{.b #b title=b}\n'
  const html = carveToHtml(djotToCarve(source))
  expect(html).toContain('class="b"')
  expect(html).toContain('id="b"')
  expect(html).toContain('title="b"')
  expect(html).toContain('data-extra="x"')
  expect(html).not.toContain('class="a b"')
})

it.each([
  ['{.a % .bogus #bogus title=bogus %}', '', '<p><a href="/u" class="a">x</a></p>'],
  [
    '{.a title="a .bogus #bogus % comment %" key="a b"}',
    '',
    '<p><a href="/u" class="a" title="a .bogus #bogus % comment %" key="a b">x</a></p>',
  ],
  [
    '{.a title=base key="a b"}',
    '{.b % .bogus key=bogus % title="own .c #d % value %"}',
    '<p><a href="/u" class="b" title="own .c #d % value %" key="a b">x</a></p>',
  ],
  [
    '{.a title="a \\"quoted\\" .b #c %"}',
    '',
    '<p><a href="/u" class="a" title="a &quot;quoted&quot; .b #c %">x</a></p>',
  ],
  ['{.a class=b .c}', '', '<p><a href="/u" class="b c">x</a></p>'],
])('merges parsed reference attributes in %s with %s', (base, own, expected) => {
  const source = `[x][]${own}\n\n${base}\n[x]: /u\n`
  expect(carveToHtml(djotToCarve(source))).toBe(expected)
  const sortAttributes = (html: string): string =>
    html.replace(
      /<a ([^>]+)>/,
      (_all, attrs: string) =>
        '<a ' +
        [...attrs.matchAll(/[\w-]+="[^"]*"/g)]
          .map((match) => match[0])
          .sort()
          .join(' ') +
        '>',
    )
  expect(sortAttributes(renderHTML(parse(source)).trim())).toBe(sortAttributes(expected))
})

it.each(['# heading', '> quote', '::::'])('keeps a block marker under a code-only paragraph literal: %s', (marker) => {
  const source = '`a`\n' + marker + '\n'
  expect(carveToHtml(djotToCarve(source))).toBe('<p><code>a</code>\n' + marker.replace('>', '&gt;') + '</p>')
})

it('pairs a div on a list item marker with a longer closer', () => {
  const converted = djotToCarve('- ::: foo\n  Hi\n  ::::')
  expect(carveToHtml(converted)).toContain('<div class="foo">')
  expect(carveToHtml(converted)).not.toContain('::::')
  expect(converted).toContain('\n  :::')
})

it.each(['-', '*', '1.'])('closes a div inside its owning %s item before the next item', (marker) => {
  const indent = marker === '1.' ? '   ' : '  '
  const next = marker === '1.' ? '2.' : marker
  for (const gap of ['', '\n', '\n\n']) {
    const source = `${marker} ::: foo\n${indent}x\n${gap}${next} y\n`
    const converted = djotToCarve(source)
    expect(converted).toContain(`${indent}x\n${indent}:::\n${gap}${next} y`)
    const html = carveToHtml(converted)
    expect(html.match(/<div\b/g)).toHaveLength(1)
    expect(html).toMatch(/<\/div>\s*<\/li>\s*<li>(?:<p>)?y/)
  }
})

it('closes a div opened on a continuation line before leaving its item', () => {
  const source = '- a\n\n  ::: foo\n  x\n- y\n'
  expect(djotToCarve(source)).toContain('  x\n  :::\n- y\n')
})

it.each(['[x]', '![x]'])('keeps paired backticks in the %s destination unchanged', (label) => {
  expect(djotToCarve(`${label}(a\` b \`c)\n`)).toBe(`${label}(a%60%20b%20%60c)\n`)
  expect(djotToCarve(`${label}(a\` b \`c) and \` code \`\n`)).toBe(`${label}(a%60%20b%20%60c) and \`  code  \`\n`)
})

it('keeps code padding out of nested and multiline destinations', () => {
  for (const source of ['[x](a(` b `)c)\n', '[x](a` b\nc `d)\n']) {
    expect(djotCodePadding(source)).toBe(source)
  }
})

it('pads code after a literal closing bracket and inside a link label', () => {
  expect(djotCodePadding('text](a` b `c)\n')).toBe('text](a`  b  `c)\n')
  expect(djotCodePadding('[` a](b `](url)\n')).toBe('[`  a](b  `](url)\n')
})

it.each(['# h', '> q', '| t |', '::: n\n   in\n   :::', '***'])(
  'escapes an ordered marker continuing the paragraph after %s',
  (block) => {
    const source = `1. a\n   ${block}\n   1. c\n2. d\n`
    const converted = djotToCarve(source)
    expect(converted).toContain('   1\\. c')
    expect(
      carveToHtml(converted)
        .replace(/\s+/g, ' ')
        .replace(/> | </g, (space) => space.trim())
        .trim(),
    ).toBe(
      renderHTML(parse(source))
        .replace(/\s+/g, ' ')
        .replace(/> | </g, (space) => space.trim())
        .trim(),
    )
  },
)

it.each(['-', '*'])('keeps a %s list loose after a literal nested marker and a block', (marker) => {
  const source = `${marker} a\n  ${marker} c\n\n  # h\n${marker} d\n`
  expect(carveToHtml(djotToCarve(source))).toContain('<li><p>d</p></li>')
})

it('keeps a list loose when an earlier item contains two paragraphs', () => {
  const source = '- a\n\n  second\n\n  - nested\n\n- d\n'
  expect(carveToHtml(djotToCarve(source))).toContain('<li><p>d</p></li>')
})

it.each(['# h', '```\n  x\n  ```', '> q', '| t |', '***'])(
  'keeps a list loose around a nested list and a %s block',
  (block) => {
    for (const content of [`  ${block}\n\n  - c`, `  - c\n\n  ${block}`]) {
      const source = `- a\n\n${content}\n\n- d\n`
      const converted = djotToCarve(source)
      expect(converted).toBe(source)
      expect(carveToHtml(converted)).toContain('<li><p>d</p></li>')
    }
  },
)

it.each(['# h', '> q', '| t |', '::: n\n  in\n  :::', '***'])(
  'ends the nested item before a parent %s block',
  (block) => {
    const source = `- a\n\n  - c\n  ${block}\n\n- d\n`
    expect(djotToCarve(source)).toBe(source)
  },
)

it.each([
  ['*', 'strong'],
  ['_', 'em'],
])('keeps adjacent %s spans separate across empty attribute groups', (delimiter, tag) => {
  for (const boundary of ['{}', '{}{}']) {
    const source = `${delimiter}a${delimiter}${boundary}${delimiter}b${delimiter}\n`
    expect(carveToHtml(djotToCarve(source))).toBe(`<p><${tag}>a</${tag}><${tag}>b</${tag}></p>`)
  }
})

it.each([
  ['> aaa\n> > bbb\n', '<blockquote><p>aaa\n&gt; bbb</p></blockquote>'],
  ['Mr. Smith\n- not a list\n', '<p>Mr. Smith\n- not a list</p>'],
  ['{-a -- b\n', '<p>{-a – b</p>'],
  ['` a `\n', '<p><code> a </code></p>'],
  ['`` `a b ``\n', '<p><code>`a b </code></p>'],
  ['[a\nb][]\n\n{title=foo}\n[a b]: /u\n', '<p><a href="/u" title="foo">a b</a></p>'],
])('preserves paragraph and inline boundaries in %s', (source, html) => {
  expect(carveToHtml(djotToCarve(source))).toBe(html)
})

it('normalizes a mixed thematic break after a list', () => {
  const html = carveToHtml(djotToCarve('- a\n\n*-*-*\n'))
  expect(html).toContain('<hr>')
  expect(html).not.toContain('<strong>')
})

it('opens a shorter nested div at a block boundary and closes both divs', () => {
  const source = ':::::: foo\n\n:::\nHi\n::::::\n\nafter\n'
  const html = carveToHtml(djotToCarve(source))
  expect(html.match(/<div/g)).toHaveLength(2)
  expect(html).toContain('</div>\n<p>after</p>')
})

it.each([
  ['[basic _link_][a_b_]\n\n[a_b_]: url\n', '[basic /link/][a_b_]\n\n[a_b_]: url\n'],
  ['[link][a and\nb]\n', '[link][a and\nb]\n'],
  ['[link][a and\nb]\n\n[a and\nb]: url\n', '[link][a and\nb]\n\n[a and\nb]: url\n'],
  ['{title=foo}\n[ref]: /url\n\n[ref][]\n', '[ref](/url){title="foo"}\n'],
  ['{title=foo}\n[ref]: /url\n\n[ref][]{title=bar}\n', '[ref](/url){title="bar"}\n'],
  ['[link _and_ link][]\n\n[link and link]: url\n', '[link /and/ link](url)\n'],
  ['- one\n\n - two\n\n  - three\n', '- one\n\n  - two\n\n    - three\n'],
  ['- a\n\n  - b\n  - c\n\n- d\n', '- a\n  - b\n  - c\n- d\n'],
  ['- a\n  - b\n\n  - c\n\n- d\n', '- a\n  \\- b\n\n  - c\n- d\n'],
  ['ab\\\t  \nc\n', 'ab\\\t  \nc\n'],
  ['> :::: foo\n> Hi\n', '> :::: foo\n> Hi\n'],
  ['\n|`|\n', '\\|`|\n'],
  ['\n|`|x\n', '\n|`|x\n'],
  ['{\n .`\n', '{\n .`\n'],
  ['` a\nc\n', '` a\nc\n'],
  ['| `a |`\n', '| `a |`\n'],
])('preserves the required source spelling in %s', (source, expected) => {
  expect(djotToCarve(source)).toBe(expected)
})

it.each(['# heading', '> quote', '| row |', '::: div'])(
  'keeps a definition term continuation literal: %s',
  (marker) => {
    const html = carveToHtml(djotToCarve(': apple\n ' + marker + '\n\n  body\n'))
    expect(html.replace(/\s+/g, ' ')).toContain('<dt>apple ' + marker.replace('>', '&gt;') + '</dt>')
    expect(html).toContain('<dd><p>body</p></dd>')
  },
)

it('keeps a nested reference use when another use is written inline', () => {
  expect(carveToHtml(djotToCarve('[*a*][]\n\n[![i](x)][a]\n\n[a]: /u\n'))).toBe(
    '<p><a href="/u"><strong>a</strong></a></p>\n<p><a href="/u"><img src="x" alt="i"></a></p>',
  )
})

it('carries definition attributes onto a link containing an image', () => {
  expect(carveToHtml(djotToCarve('{title=t}\n[ref]: /u\n\n[![i](x)][ref]\n'))).toBe(
    '<p><a href="/u" title="t"><img src="x" alt="i"></a></p>',
  )
})

it.each(['http://a.b/x{}y', 'http://a.b/{"q"}'])(
  'keeps inline normalization out of an autolink destination: %s',
  (destination) => {
    const converted = djotToCarve('<' + destination + '>\n')
    expect(converted).toContain(destination)
    expect(blockHtml(carveToHtml(converted))).toBe(blockHtml(renderHTML(parse('<' + destination + '>\n'))))
  },
)


it.each(['  - a\n* b\n', '  - a\n\n  a\n'])('preserves blocks after an indented list in %s', source => {
  expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
})

it('keeps main recovery for equal-width nested containers with rejected metadata', () => {
  const source = '::: tip Bad X\n\n::: note\nx\n:::\n:::\n'
  expect(djotToCarve(source)).toBe('\\::: tip Bad X\n\n::: note\nx\n:::\n\\:::\n')
  expect(carveToHtml(djotToCarve(source))).toBe('<p>::: tip Bad X</p>\n<aside class="admonition note" aria-label="Note">\n  <p>x</p>\n</aside>\n<p>:::</p>')
})

it('attaches word attributes across escaped punctuation', () => {
  expect(djotToCarve('foo\\*bar{.c}\n')).toBe('[foo\\*bar]{.c}\n')
  expect(carveToHtml(djotToCarve('foo\\*bar{.c}\n'))).toBe('<p><span class="c">foo*bar</span></p>')
})

it.each(['<mailto:a@b.c>\n', '<mailto:a--@b.c>\n', '<mailto:a...@b.c>\n', '<https://example.com>\n', '<a@b.c>\n'])(
  'writes an address autolink with a single scheme: %j',
  (source) => {
    const converted = djotToCarve(source)
    expect(converted).not.toContain('mailto:mailto:')
    expect(carveToHtml(converted)).toMatch(/^<p><a href="[^"]+">/)
    expect(carveToHtml(converted)).toContain('href="' + source.slice(1, -2).replace(/^(?![A-Za-z][\w+.-]*:)/, 'mailto:') + '"')
  },
)

it.each(['::: foo\n# b\n{.c}\n', '::: foo\na\n{.c}\n', '::: foo\n# b\n{.c}\n:::\n', '::: foo\n{.c}\n:::\n'])(
  'drops a trailing orphan attribute line instead of folding it into the block: %j',
  (source) => {
    expect(djotToCarve(source)).not.toContain('{.c}')
    expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(renderHTML(parse(source))))
  },
)

it('keeps an attribute line that a block follows', () => {
  expect(carveToHtml(djotToCarve('::: foo\n{.c}\n# b\n:::\n'))).toContain('class="c"')
})

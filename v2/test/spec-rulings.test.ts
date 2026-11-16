// The rulings of the 0.2 specification that the engine follows: one describe per ruling, each test named by its clause.
import { describe, expect, it } from 'vitest'
import {
  CarveOptionError, CarveTreeError, type DocumentNode, format, parse, parseTree, parseWithDiagnostics, render, renderTree, resolveTree,
  type RenderOptions, validateTree,
} from '../src/index.ts'
import { isJoining, isLetter, isUrlCharacter, isWordCharacter } from '../src/unicode.ts'
import { UNICODE_VERSION } from '../src/unicode-tables.ts'

function findings(src: string): string[] {
  return parseWithDiagnostics(src).diagnostics.map((entry) => entry.code)
}

describe('where a name ends', () => {
  it('C2-B-225: a div name, a language word and a raw format end at the first character outside their sets', () => {
    const result = parseWithDiagnostics('::: glossary>\nq\n:::\n\n```js}\ncode\n```\n\n```=html~\n<b>x</b>\n```\n\n::: note{.x}\nn\n:::\n')
    expect(result.document.children.map((node) => node.type)).toEqual(['directive', 'code_block', 'raw_block', 'admonition'])
    expect(result.document.children).toMatchObject([{ kind: 'glossary' }, { syntax: 'js' }, { format: 'html' }, { kind: 'note' }])
    expect(result.diagnostics.map((entry) => entry.code))
      .toEqual(['fence-title-syntax', 'fence-title-syntax', 'fence-title-syntax', 'fence-opener-fallback'])
  })

  it('C2-B-225, C2-B-105: a brace block glued to a raw format or a div name is an attribute block', () => {
    expect(findings('```=html{.c}\na\n```\n')).toEqual(['fence-opener-fallback'])
    expect(findings('::: glossary{.c}\nq\n:::\n')).toEqual(['fence-opener-fallback'])
    expect(findings('::: x{.c}\nq\n:::\n')).toEqual(['fence-opener-fallback'])
  })

  it('C2-B-122: the report of what is glued to a raw format names that text', () => {
    const message = parseWithDiagnostics('```=html~\na\n```\n').diagnostics[0]?.message ?? ''
    expect(message).toContain('"~"')
    expect(message).not.toContain('typographic')
  })

  it('C2-B-225: a raw format starts with a letter, so a digit or an underscore after the equals sign names no format', () => {
    for (const src of ['```=1x\na\n```\n', '```=_x\na\n```\n']) {
      expect(parseWithDiagnostics(src).document.children[0]?.type, src).toBe('code_block')
    }
    expect(parseWithDiagnostics('```=x_1-\na\n```\n').document.children[0]).toMatchObject({ type: 'raw_block', format: 'x_1-' })
  })
})

describe('the Unicode version', () => {
  it('C2-I-127, C2-I-047: a letter new in Unicode 18.0.0 is a letter before a star', () => {
    expect(render('𽀀*𰨌*')).toBe('<p>𽀀*𰨌*</p>')
  })

  it('C2-I-127: every category test reads the ranges of data/unicode-categories.json', () => {
    expect(UNICODE_VERSION).toBe('18.0.0')
    expect(isLetter(0x3d000)).toBe(true)
    expect(isWordCharacter(0x1246f)).toBe(true)
    expect(isJoining(0x5c8)).toBe(true)
    expect(isLetter(0x1246f)).toBe(false)
  })

  it('C2-H-148, C2-I-127: a heading that starts with a number new in Unicode 18.0.0 takes the prefix', () => {
    expect(render('# \u{1246f} x')).toContain('id="s-\u{1246f}-x"')
  })

  it('C2-I-122: a URL character outside ASCII has no White_Space, is no control and no format character', () => {
    for (const code of [0x85, 0xa0, 0x2028, 0x3000, 0x9f, 0x200b, 0xfeff]) expect(isUrlCharacter(code), code.toString(16)).toBe(false)
    for (const code of [0xe9, 0x4e00, 0x3d000]) expect(isUrlCharacter(code), code.toString(16)).toBe(true)
  })
})

describe('the include shift', () => {
  it('C2-B-205: a shift has one to nine digits; ten are outside the shape and the line is a paragraph', () => {
    const document = parse('{{ a.crv @shift:-123456789 }}\n\n{{ a.crv @shift:1234567890 }}\n\n{{ a.crv @shift:+000000001 }}\n')
    expect(document.children.map((node) => node.type)).toEqual(['include', 'paragraph', 'include'])
    expect(document.children[0]).toMatchObject({ options: { shift: -123456789 } })
    expect(document.children[2]).toMatchObject({ options: { shift: 1 } })
    expect(parse('{{ a.crv @shift:99999999999999999999 }}\n').children[0]?.type).toBe('paragraph')
  })
})

describe('the include shift in a supplied tree', () => {
  it('C2-B-205, C2-A-181: a supplied shift of ten digits is refused', () => {
    const include = (shift: number): DocumentNode => ({
      type: 'document', astVersion: '2.0', children: [{ type: 'include', path: 'a.crv', options: { shift } }],
    })
    expect(() => validateTree(include(999_999_999))).not.toThrow()
    expect(() => validateTree(include(1_234_567_890))).toThrow(CarveTreeError)
  })
})

describe('the neighbors of plus-minus and arrows', () => {
  it('C2-I-117, C2-I-116: only characters of the same text are neighbors; a delimiter mark is none', () => {
    expect(render('{--->-} and {-<---} and {++-1+} and {++-+} and C++-style and a{%x%}+-b'))
      .toBe('<p><del>→</del> and <del>←</del> and <ins>±1</ins> and <ins>±</ins> and C++-style and a±b</p>')
    expect(render('{-a+--} and {++-{%c%}+}')).toBe('<p><del>a±</del> and <ins>±</ins></p>')
  })

  it('C2-I-117, C2-I-026: a braced comment between two characters is transparent', () => {
    expect(render('+{%x%}+-b and a+-{%x%}+ and a+-{%x%}c')).toBe('<p>++-b and a+-+ and a±c</p>')
  })
})

describe('block image paragraphs', () => {
  it('C2-H-020: an attributed block image paragraph keeps its <p>, which carries the attributes and the lang', () => {
    expect(render('{.c #i}\n![a](x.png)\n\n{:de}\n![b](y.png)\n\n![c](z.png)\n')).toBe([
      '<p id="i" class="c"><img src="x.png" alt="a"></p>', '<p lang="de"><img src="y.png" alt="b"></p>', '<img src="z.png" alt="c">',
    ].join('\n'))
  })
})

describe('the social option', () => {
  const social = { mentionUrl: 'https://x.org/u/{name}' }

  it('C2-H-167: a linked mention is a link for the profile: an inert span where links are outside it', () => {
    expect(render('@ann.b and #topic', { social }))
      .toBe('<p><a class="mention" href="https://x.org/u/ann.b"><strong>@ann.b</strong></a> and <span class="tag"><strong>#topic</strong></span></p>')
    expect(render('@ann', { social, profile: 'minimal' })).toBe('<p><span class="mention"><strong>@ann</strong></span></p>')
    expect(render('@ann', { social, profile: 'comment' }))
      .toBe('<p><a class="mention" href="https://x.org/u/ann" rel="nofollow ugc"><strong>@ann</strong></a></p>')
  })

  it('C2-H-126: the resolver is asked first, the template when it returns nothing, and an empty URL is no URL', () => {
    const resolveMention = (name: string): string | undefined => (name === 'a' ? '/r/a' : name === 'e' ? '' : undefined)
    expect(render('@a @b @e', { social: { ...social, resolveMention } })).toBe('<p><a class="mention" href="/r/a"><strong>@a</strong></a> '
      + '<a class="mention" href="https://x.org/u/b"><strong>@b</strong></a> <span class="mention"><strong>@e</strong></span></p>')
  })

  it('C2-H-126: the name is percent-encoded as UTF-8 except ASCII letters, digits and -_.!~*\'()', () => {
    const document: DocumentNode = {
      type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [{ type: 'mention', kind: 'user', target: "é a/b-_.!~*'()" }] }],
    }
    expect(render(document, { social: { mentionUrl: '/u/{name}/{name}' } }))
      .toContain('href="/u/%C3%A9%20a%2Fb-_.!~*&apos;()/%C3%A9%20a%2Fb-_.!~*&apos;()"')
  })

  it('C2-H-126: social has four optional fields and no other', () => {
    expect(() => render('@a', JSON.parse('{"social":{"mentionUrl":"/u","other":1}}') as RenderOptions)).toThrow(CarveOptionError)
  })
})

describe('degraded captions', () => {
  it('C2-H-165: the caption of a degraded figure, table or figure group keeps its number', () => {
    expect(render('![i](a.png)\n^ Figure #: cap\n\n| t |\n^ Table #: tc\n\n:::: figure\n::::\n^ Empty #\n', { profile: 'comment' }))
      .toBe('<p>[img: i]</p>\n<p>Figure 1: cap</p>\n<p>t</p>\n<p>Table 1: tc</p>\n<p>Empty 1</p>')
  })
})

describe('references to degraded headings', () => {
  const source = '## Sub *em* `code`\n\n[Sub em code][] and </#Sub-em-code>\n'

  it('C2-H-177: a reference to a heading the profile degrades is written in its unresolved form', () => {
    expect(render(source, { profile: 'comment' })).toBe('<p>## Sub em code</p>\n<p>[Sub em code][] and &lt;/#Sub-em-code&gt;</p>')
    expect(render('{#h}\n## Sub\n\n[x][Sub]{.c} and </#h>\n', { profile: 'article' })).toContain('<a href="#h" class="c">x</a>')
  })

  it('C2-H-177, C2-H-121: resolution does not read the profile, so the tree is the same with and without it', () => {
    const plain = resolveTree(parseTree(source)).document
    const profiled = resolveTree(parseTree(source), { profile: 'comment' })
    expect(profiled.document).toEqual(plain)
    renderTree(profiled)
    expect(profiled.document).toEqual(plain)
  })
})

describe('heading lookup by plain text', () => {
  it('C2-I-084: emphasis in the key finds a plain heading, and so does the braced form', () => {
    expect(render('# A bold title\n\n[A *bold* title][] and [x][A {*bold*} title]\n')).toBe([
      '<section id="A-bold-title">', '  <h1>A bold title</h1>',
      '  <p><a href="#A-bold-title">A <strong>bold</strong> title</a> and <a href="#A-bold-title">x</a></p>', '</section>',
    ].join('\n'))
  })

  it('C2-I-084, C2-W-004: a braced heading is found by bare emphasis, before and after the formatter', () => {
    const source = '# A {*bold*} title\n\n[A *bold* title][] and [A bold title][]\n'
    const html = render(source)
    expect(html.match(/href="#A-bold-title"/g)).toHaveLength(2)
    expect(render(format(source))).toBe(html)
  })

  it('C2-I-084, C2-A-109: no source text is read, so a tree resolves the same without its source', () => {
    for (const source of ['# A bold title\n\n[A *bold* title][] and [x][A {*bold*} title]\n', '# A {*bold*} title\n\n[A *bold* title][]\n']) {
      const tree = parse(source, { positions: false })
      expect(render(JSON.parse(JSON.stringify(tree)) as DocumentNode)).toBe(render(source))
    }
  })

  it('C2-I-081, C2-A-213: a supplied shortcut never reaches a heading', () => {
    const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [
      { type: 'heading', level: 1, children: [{ type: 'text', value: 'H' }] },
      { type: 'paragraph', children: [{ type: 'link', key: 'H', namespace: 'link', refForm: 'shortcut', children: [{ type: 'text', value: 'H' }] }] },
    ] }
    expect(render(document)).toContain('<p>[H]</p>')
  })

  it('C2-I-084, C2-H-143: a link gives the text of its children before any reference resolves, its own heading included', () => {
    expect(render('# [g][]\n')).toBe('<section id="g">\n  <h1><a href="#g">g</a></h1>\n</section>')
  })

  it('C2-I-084: an escaped apostrophe gives no glyph, so the key does not find the smart heading', () => {
    expect(render("# It's a*b\n\n[go][It\\'s a\\*b]\n")).toContain('<p>[go][It\\\'s a\\*b]</p>')
  })
})

describe('spaces at the end of a line', () => {
  it('C2-I-002, C2-I-015: the spaces at a line end are removed inside code, math, literal, raw spans and comments', () => {
    const tree = parse('`a  \n  b` x $`m  \nn` !`l  \nk` ``r  \ns``{=html} {%c  \nd%}')
    const paragraph = tree.children[0]
    const values = paragraph?.type === 'paragraph'
      ? paragraph.children.flatMap((node) => ('value' in node && node.type !== 'text' ? [node.value] : []))
      : []
    expect(values).toEqual(['a\nb', 'm\nn', 'l\nk', 'r\ns', 'c\nd'])
  })

  it('C2-A-151: a line comment at the end of a line owns the spaces after it, and the soft break starts at the line ending', () => {
    const paragraph = parse('a %% x  \nb').children[0]
    expect(paragraph).toMatchObject({ pos: { startOffset: 0, endOffset: 10 } })
    const spans = paragraph?.type === 'paragraph' ? paragraph.children.map((node) => [node.type, node.pos?.startOffset, node.pos?.endOffset]) : []
    expect(spans).toEqual([['text', 0, 1], ['comment', 1, 8], ['soft_break', 8, 9], ['text', 9, 10]])
  })

  it('C2-A-151: on the last line of a content the line comment ends at the end of the spaces', () => {
    const paragraph = parse('c %% z  ').children[0]
    expect(paragraph).toMatchObject({ pos: { startOffset: 0, endOffset: 8 } })
    expect(paragraph?.type === 'paragraph' ? paragraph.children[1]?.pos : null).toMatchObject({ startOffset: 1, endOffset: 8 })
    const quote = parse('> a %% x  \n> b').children[0]
    const inner = quote?.type === 'block_quote' && quote.children[0]?.type === 'paragraph' ? quote.children[0].children : []
    expect(inner.map((node) => [node.type, node.pos?.startOffset, node.pos?.endOffset]))
      .toEqual([['text', 2, 3], ['comment', 3, 10], ['soft_break', 10, 13], ['text', 13, 14]])
  })

  it('C2-A-151: an include and a heading end at the line ending, after their trailing spaces', () => {
    expect(parse('{{ a.crv }}  \n').children[0]).toMatchObject({ type: 'include', pos: { startOffset: 0, endOffset: 13 } })
    expect(parse('{{ a.crv }}  ').children[0]).toMatchObject({ type: 'include', pos: { startOffset: 0, endOffset: 13 } })
    expect(parse('# H  \n').children[0]).toMatchObject({ type: 'heading', pos: { startOffset: 0, endOffset: 5 } })
  })

  it('C2-A-153: a soft break spans the dropped spaces and the line ending', () => {
    const paragraph = parse('a  \nb').children[0]
    expect(paragraph?.type === 'paragraph' ? paragraph.children[1] : null).toMatchObject({ type: 'soft_break', pos: { startOffset: 1, endOffset: 4 } })
  })
})

// The findings of the first code review of the 0.2 engine, one test per finding, named with the clause each one cites.
import { describe, expect, it } from 'vitest'
import { CarveTreeError, decodeTree, foldLabel, format, parse, render, stringOffsetOfByte, utf8Length, write, writeWithDiagnostics } from '../src/index.ts'
import { CarveOptionError } from '../src/options.ts'
import { type DocumentNode, pointerKey, pointerToken } from '../src/ast.ts'

/** The path and the reason of the refusal of `json`, or null when it is accepted. */
function refusal(json: unknown): string | null {
  try {
    decodeTree(JSON.stringify(json))
    return null
  } catch (error) {
    if (!(error instanceof CarveTreeError)) throw error
    return error.message
  }
}

const DIGEST = `sha256:${'0'.repeat(64)}`

function inParagraph(...children: unknown[]): Record<string, unknown> {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

describe('linear passes', () => {
  it('C2-I-099: a term reads the character behind the empty spans that follow it, and many spans stay linear', () => {
    expect(render('*[A]: B\n\nA[]{.x}[]{.x} A[]{.x}b')).toBe(
      '<p><abbr title="B">A</abbr><span class="x"></span><span class="x"></span> A<span class="x"></span>b</p>',
    )
    const spans = parse(`*[A]: B\n\nA ${'[]{.x}'.repeat(20000)} A`).children.at(-1) as { children: { type: string }[] }
    expect(spans.children.filter((node) => node.type === 'abbreviation')).toHaveLength(2)
  })

  it('C2-A-035: a later key replaces an earlier one of the same name at its first place, over blocks and lines', () => {
    expect(parse('{k=1 j=2 K=3}\nx').children[0]!.attrs).toEqual({ keyValues: [['k', '3'], ['j', '2']] })
    expect(parse('{k=1}\n{j=2}\n{K=3}\nx').children[0]!.attrs).toEqual({ keyValues: [['k', '3'], ['j', '2']] })
    const many = parse(`{${Array.from({ length: 20000 }, (_, index) => `k${index % 10000}=${index}`).join(' ')}}\nx`).children[0]!
    expect(many.attrs?.keyValues).toHaveLength(10000)
    expect(many.attrs?.keyValues?.[0]).toEqual(['k0', '10000'])
  })

  it('C2-H-141: a reference and its definition with many keys merge, and the reference decides a key', () => {
    expect(render('[x][r]{a=1 B=2}\n\n{b=3 c=4}\n[r]: /u')).toBe('<p><a href="/u" c="4" a="1" B="2">x</a></p>')
  })
})

describe('reading a supplied tree', () => {
  it('C2-A-167, C2-A-170: a payload alternative that is no object with a media type is refused with its path', () => {
    const extension = (payload: unknown): unknown => inParagraph({ type: 'inline_extension', name: 'a.b', children: [], payload })
    expect(refusal(extension([null]))).toBe('/children/0/children/0/payload/0: not a payload alternative')
    expect(refusal(extension([{ value: 'x' }]))).toBe('/children/0/children/0/payload/0/format: not a string')
    expect(refusal(extension([{ format: '', value: 'x' }]))).toBe('/children/0/children/0/payload/0/format: an empty media type')
    expect(refusal(extension([{ format: 'text/plain', other: 1 }]))).toBe('/children/0/children/0/payload/0/other: not a field of a payload alternative')
    expect(refusal(extension([{ format: 'text/plain', value: { a: [1] } }]))).toBeNull()
  })

  it('C2-A-014 to C2-A-019: the envelope is checked before its document', () => {
    const document = { type: 'document', astVersion: '2.0', children: [] }
    expect(refusal({ astVersion: '3.0', document })).toBe('/astVersion: major version 3 is not read by this engine')
    expect(refusal({ astVersion: '2.01', document })).toBe('/astVersion: not major.minor')
    expect(refusal({ document })).toBe('/astVersion: a required field is missing')
    expect(refusal({ astVersion: '2.0', extensions: [{ name: 'a.b', required: true }], document })).toBe('/extensions/0: an unknown required extension')
    expect(refusal({ astVersion: '2.0', other: 1, document })).toBe('/other: not a field of the envelope')
    expect(refusal({ astVersion: '2.3', extensions: [{ name: 'a.b', required: false }], document })).toBeNull()
    expect(refusal({ astVersion: '2.0', document: { ...document, astVersion: '3.0' } })).toBe('/document/astVersion: major version 3 is not read by this engine')
  })

  it('C2-A-131: an image and an extension name resources of the manifest', () => {
    const resources = [{ id: 'r', mediaType: 'image/png', digest: DIGEST }]
    expect(refusal(inParagraph({ type: 'image', resourceId: 'missing' }))).toBe('/children/0/children/0/resourceId: no resource has the id "missing"')
    expect(refusal({ ...inParagraph({ type: 'image', resourceId: 'r' }), resources })).toBeNull()
    const extension = { type: 'inline_extension', name: 'a.b', children: [], resourceIds: ['r', 'q'] }
    expect(refusal({ ...inParagraph(extension), resources })).toBe('/children/0/children/0/resourceIds/1: no resource has the id "q"')
  })

  it('C2-A-132: references are counted in every slot that holds nodes, ruby pairs and extension slots included', () => {
    const resources = [{ id: 'r', mediaType: 'image/png', digest: DIGEST }]
    const images = (count: number): unknown[] => Array.from({ length: count }, () => ({ type: 'image', resourceId: 'r' }))
    const ruby = (count: number): unknown => ({ ...inParagraph({ type: 'ruby', pairs: [{ type: 'rubyPair', base: images(count), annotation: [] }] }), resources })
    expect(refusal(ruby(4096))).toBeNull()
    expect(refusal(ruby(4097))).toBe('/children/0/children/0/pairs/0/base/4096: more than 4096 resource references')
    const slots = (count: number): unknown => ({ ...inParagraph({ type: 'inline_extension', name: 'a.b', children: [], slots: { s: images(count) } }), resources })
    expect(refusal(slots(4096))).toBeNull()
    expect(refusal(slots(4097))).toBe('/children/0/children/0/slots/s/4096: more than 4096 resource references')
  })

  it('C2-A-028: a ruby pair is closed', () => {
    expect(refusal(inParagraph({ type: 'ruby', pairs: [{ type: 'rubyPair', base: [], annotation: [], x: 1 }] }))).toBe('/children/0/children/0/pairs/0/x: not a field of rubyPair')
  })
})

describe('the attribute filter', () => {
  it('C2-H-075, C2-H-161: the title and the datetime that abbr and time give pass the filter of an authored value', () => {
    expect(render('[x]{abbr=javascript:alert(1)}')).toBe('<p><abbr title="">x</abbr></p>')
    expect(render('[x]{time=javascript:alert(1)}')).toBe('<p><time datetime="">x</time></p>')
    expect(render('[x]{abbr="Shell: bash"}')).toBe('<p><abbr title="">x</abbr></p>')
    expect(render('[x]{abbr=HTML time=2024}')).toBe('<p><time datetime="2024"><abbr title="HTML">x</abbr></time></p>')
  })

  it('C2-H-161: an authored class and the language of a supplied tree pass the filter too', () => {
    expect(render('[x]{.a class="javascript:x"}')).toBe('<p><span class="a">x</span></p>')
    expect(render(decodeTree(JSON.stringify(inParagraph({ type: 'span', lang: 'javascript:x', children: [{ type: 'text', value: 'x' }] }))))).toBe('<p><span lang="">x</span></p>')
  })

  it('C2-H-057: the vertical alignment of a supplied cell is written only as a CSS keyword, so it adds no declaration', () => {
    const table = (valign: string): string => render(decodeTree(JSON.stringify({
      type: 'document', astVersion: '2.0', children: [{
        type: 'table', columns: [{ type: 'table_column' }], children: [{
          type: 'table_body', children: [{ type: 'table_row', children: [{ type: 'table_cell', header: false, valign, children: [] }] }],
        }],
      }],
    })))
    expect(table('baseline')).toContain('<td style="vertical-align: baseline;"></td>')
    expect(table('top; background-image: url(javascript:alert(1))')).toContain('<td></td>')
  })
})

describe('the title of a code block', () => {
  const titled = JSON.stringify({
    type: 'document', astVersion: '2.0',
    children: [{ type: 'code_block', value: 'a\n', title: [{ type: 'emphasis', children: [{ type: 'text', value: 'Hi' }] }, { type: 'text', value: ' there' }] }],
  })

  it('C2-A-073, C2-H-048: an inline title of a supplied tree is the title attribute as plain text', () => {
    expect(render(decodeTree(titled))).toBe('<pre title="Hi there"><code>a\n</code></pre>')
  })

  it('C2-W-117: the writer writes it as text and reports the markup it cannot spell', () => {
    const output = writeWithDiagnostics(decodeTree(titled))
    expect(output.source).toBe('``` "Hi there"\na\n```\n')
    expect(output.diagnostics.map((finding) => finding.code)).toContain('field-unspellable')
  })
})

describe('byte offsets', () => {
  it('C2-A-140: an offset inside a four-byte character gives the start of the character, never its second half', () => {
    expect([0, 1, 2, 3, 4].map((byte) => stringOffsetOfByte('😀x', byte))).toEqual([0, 0, 0, 0, 2])
    expect(stringOffsetOfByte('a😀', 3)).toBe(1)
  })

  it('C2-A-010: an unpaired surrogate counts as U+FFFD, three bytes, as UTF-8 encoders write it', () => {
    for (const text of ['\ud800x\n', 'a\udc00', '\udc00\ud800', '😀\ud800', 'é😀']) expect(utf8Length(text)).toBe(Buffer.byteLength(text))
    expect(parse('\ud800x\n').srcByteLength).toBe(5)
    expect(stringOffsetOfByte('\ud800x', 3)).toBe(1)
  })
})

describe('option values', () => {
  it('C2-H-137, C2-H-128: a urlPolicy that is not a deny list or an allow list of strings is refused', () => {
    const refused = (urlPolicy: unknown): string => {
      try {
        render('[x](javascript:y)', { urlPolicy } as never)
        return 'accepted'
      } catch (error) {
        return error instanceof CarveOptionError ? error.message : `other: ${String(error)}`
      }
    }
    expect(refused({ allow: 'https' })).toBe('option urlPolicy: allow is not a list of strings')
    expect(refused({ deny: [1] })).toBe('option urlPolicy: deny is not a list of strings')
    expect(refused({ allow: ['https'], deny: ['ftp'] })).toBe('option urlPolicy: both a deny list and an allow list')
    expect(refused({ other: [] })).toBe('option urlPolicy: unknown field other')
    expect(refused(null)).toBe('option urlPolicy: not an object with a deny list or an allow list')
    expect(refused(['ftp'])).toBe('option urlPolicy: not an object with a deny list or an allow list')
    expect(refused({ allow: ['https'] })).toBe('accepted')
  })

  it('C2-H-137: symbols, labels and social of the wrong shape are refused too', () => {
    expect(() => render('x', { symbols: { a: 1 } } as never)).toThrow(CarveOptionError)
    expect(() => render('x', { labels: 'x' } as never)).toThrow(CarveOptionError)
    expect(() => render('x', { social: { mentionUrl: 1 } } as never)).toThrow(CarveOptionError)
    expect(() => render('x', { social: { other: '' } } as never)).toThrow(CarveOptionError)
    expect(render('x', { symbols: {}, labels: {}, social: null })).toBe('<p>x</p>')
  })
})

describe('the spelling of an include directive', () => {
  it('C2-B-202, C2-W-058: a path is bare where the bare form holds it, an apostrophe included', () => {
    expect(format("{{ a'b.crv }}\n")).toBe("{{ a'b.crv }}\n")
    expect(format('{{ "a b.crv" }}\n')).toBe('{{ "a b.crv" }}\n')
    expect(format('{{ "a#b.crv" }}\n')).toBe('{{ "a#b.crv" }}\n')
    expect(format('{{ a\\b.crv }}\n')).toBe('{{ a\\b.crv }}\n')
  })

  it('C2-H-171, C2-W-058: the renderer shows the directive as the writer writes it', () => {
    for (const source of ["{{ a'b.crv }}", '{{ "a b.crv" }}', '{{ a.crv #s @lines:1-2 @code }}', '{{ a.crv @lines:"1 - 2" }}', '{{ a.crv @lines:1"2 }}']) {
      expect(render(source)).toBe(`<p>${format(source).trimEnd()}</p>`)
    }
    expect(format('{{ a.crv @lines:1"2 }}')).toBe('{{ a.crv @lines:1"2 }}\n')
  })

  it('C2-B-204: a value that starts with a quote is written in quotes, so it reads back as the same value', () => {
    const tree = JSON.stringify({ type: 'document', astVersion: '2.0', children: [{ type: 'include', path: 'a.crv', options: [['lines', "'1"]] }] })
    expect(write(decodeTree(tree))).toBe('{{ a.crv @lines:"\'1" }}\n')
    expect(parse(write(decodeTree(tree))).children[0]).toMatchObject({ options: [['lines', "'1"]] })
  })
})

// The findings of the second code review.
const BACKTICK = '`'
const ESCAPED_RUN = `\\${BACKTICK}${BACKTICK}`
// A quadratic pass over the inputs below takes a minute; a linear one a few dozen milliseconds.
const LINEAR_BUDGET_MS = 3000

type Nested = { type: string, value?: string, children: Nested[], [key: string]: unknown }

/** The texts of the cells of the first row of the table that `source` opens. */
function cellTexts(source: string): string[] {
  const table = parse(source).children[0] as unknown as Nested
  return table.children[0]!.children[0]!.children.map((cell) => cell.children.flatMap((block) => block.children.map((node) => node.value ?? '')).join(''))
}

describe('table rows in linear time', () => {
  it('C2-B-169: a backtick run behind an escaped backtick protects no pipe without a closer of its length', () => {
    expect(cellTexts(`| ${ESCAPED_RUN}x | y |`)).toEqual([`${BACKTICK}x`, 'y'])
    expect(cellTexts(`| ${BACKTICK}a | b${BACKTICK} |`)).toHaveLength(1)
    // A test that runs past its timeout still passes when it never yields, so the time is checked here.
    const started = performance.now()
    expect(cellTexts(`|${` ${ESCAPED_RUN}x |`.repeat(20000)}`)).toHaveLength(20000)
    expect(parse(`| a |\n+${` ${ESCAPED_RUN}x |`.repeat(20000)}`).children).toHaveLength(1)
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS)
  })
})

describe('counts that once shared an integer', () => {
  const firstCell = (source: string): Record<string, unknown> => {
    const table = parse(source).children[0] as unknown as Nested
    return table.children[0]!.children[0]!.children[0]! as unknown as Record<string, unknown>
  }

  it('C2-B-172, C2-A-092: a column span past 65,535 columns keeps its width and spans one row', () => {
    const cell = firstCell(`|a${'|<'.repeat(65536)}|`)
    expect(cell.colspan).toBe(65537)
    expect(cell.rowspan).toBeUndefined()
  })

  it('C2-B-172: a row span past 65,535 rows keeps its height', () => {
    expect(firstCell(`| a |\n${'| ^ |\n'.repeat(65536)}`).rowspan).toBe(65537)
  })

  it('C2-B-178, C2-B-187: head rows and footer rows past 65,535 are counted in full', () => {
    const groups = (source: string): string[] => (parse(source).children[0] as unknown as Nested).children.map((group) => `${group.type} ${group.children.length}`)
    expect(groups(`${'|= a |\n'.repeat(65537)}| b |\n`)).toEqual(['table_head 65537', 'table_body 1'])
    expect(groups(`{footer-rows=65537}\n${'| a |\n'.repeat(65540)}`)).toEqual(['table_body 3', 'table_foot 65537'])
  })
})

describe('a lone CR', () => {
  it('C2-B-010: a lone CR at the end of the input is part of the line', () => {
    expect(render('a\r')).toBe('<p>a\r</p>')
    expect(parse('a\r').srcByteLength).toBe(2)
    expect(parse('a\r', { positions: false }).children).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'a\r' }] }])
    expect(render('a\r\n')).toBe('<p>a</p>')
    expect(render('- a\r')).toBe('<ul>\n  <li>a\r</li>\n</ul>')
  })

  it('C2-B-010: a lone CR in an opener line is title text, not the end of the line', () => {
    expect(parse('::: note "a\rb"\nx\n:::\n').children[0]).toMatchObject({ type: 'admonition', title: [{ type: 'text', value: 'a\rb' }] })
    expect(parse('::: note "a"\r\nx\n:::\n').children[0]).toMatchObject({ type: 'admonition', title: [{ type: 'text', value: 'a' }] })
  })

  it('C2-B-010, C2-W-011: a text that ends a line with a lone CR has no spelling, and the writer reports it', () => {
    expect(writeWithDiagnostics(parse('a\r')).diagnostics.map((finding) => finding.channel)).toEqual(['render-loss'])
  })
})

describe('the depth cap over blocks and inlines together', () => {
  /** The children of the innermost quote of `lines`, each behind `quotes` quote marks. */
  const inQuotes = (quotes: number, lines: string[]): Nested[] => {
    let node = parse(lines.map((line) => '> '.repeat(quotes) + line).join('\n'), { positions: false }) as unknown as Nested
    while (node.children[0]?.type === 'block_quote') node = node.children[0]
    return node.children
  }

  it('C2-B-190, C2-I-118: a div title counts the blocks around it and the div, so a link past 200 is text', () => {
    expect(inQuotes(199, ['::: note "[x](/u)"'])[0]!.title).toEqual([{ type: 'text', value: '[x](/u)' }])
    expect(inQuotes(198, ['::: note "[x](/u)"'])[0]!.title).toEqual([{ type: 'link', href: '/u', children: [{ type: 'text', value: 'x' }] }])
  })

  it('C2-B-190: a description mark that would open a container past the cap is term text, and nothing crashes', () => {
    expect(inQuotes(199, [':: t', ': d'])).toEqual([{
      type: 'definition_list',
      children: [{ type: 'definition_term', children: [{ type: 'text', value: 't' }, { type: 'soft_break' }, { type: 'text', value: ': d' }] }],
    }])
    expect(inQuotes(199, [':: t', '', ': d']).map((node) => node.type)).toEqual(['definition_list', 'paragraph'])
    expect(inQuotes(198, [':: t', ': d'])[0]!.children.map((node) => node.type)).toEqual(['definition_term', 'definition_description'])
  })
})

describe('writer output that read back as another tree', () => {
  const BACKSLASH = '\\'

  it('C2-W-002, C2-W-003: a backtick in emphasis keeps its escape, so the emphasis stays bare and reads back', () => {
    const source = `/${BACKSLASH}${BACKTICK}:/`
    expect(format(source)).toBe(`${source}\n`)
    expect(format(`*${BACKSLASH}${BACKTICK}:*`)).toBe(`*${BACKSLASH}${BACKTICK}:*\n`)
    expect(writeWithDiagnostics(parse(source)).diagnostics).toEqual([])
  })

  it('C2-W-002, C2-W-003: a backtick behind a code span is escaped, so the span does not take it', () => {
    const source = `${BACKTICK}a${BACKTICK}${BACKSLASH}${BACKTICK}`
    expect(format(source)).toBe(`${source}\n`)
    expect(format(`${source}b`)).toBe(`${source}b\n`)
    expect(writeWithDiagnostics(parse(source)).diagnostics).toEqual([])
  })

  it('C2-W-112: a code span with an attribute block is not joined to the code span behind it', () => {
    const source = `x${BACKTICK}a${BACKTICK}{.c}${BACKTICK}a${BACKTICK}`
    expect(format(source)).toBe(`${source}\n`)
    expect(writeWithDiagnostics(parse(source)).diagnostics).toEqual([])
  })

  it('C2-W-011: an output that reads back as another tree always carries a report', () => {
    for (const source of ['a\r', `${BACKTICK}a${BACKTICK}${BACKSLASH}${BACKTICK}`, `/${BACKSLASH}${BACKTICK}:/`]) {
      const output = writeWithDiagnostics(parse(source))
      const tree = (text: string): string => JSON.stringify(parse(text, { positions: false }).children)
      const same = tree(output.source) === tree(source)
      expect(same || output.diagnostics.length > 0).toBe(true)
    }
  })
})

describe('what the random writer gates found', () => {
  const BACKSLASH = '\\'

  it('C2-B-118, C2-W-037: an info string with a backtick has no spelling on a backtick fence, and the writer leaves it out', () => {
    const output = writeWithDiagnostics(parse(`~~~${BACKTICK}\nx\n~~~`))
    expect(output.source).toBe('```\nx\n```\n')
    expect(output.diagnostics.map((finding) => finding.code)).toEqual(['field-unspellable'])
    expect(format(output.source)).toBe(output.source)
  })

  it('C2-W-026: a line behind a hard break that would read as a list marker is kept text by an escape', () => {
    expect(format(` - ${BACKSLASH}\n- a`)).toBe(`- ${BACKSLASH}\n  ${BACKSLASH}- a\n`)
    expect(format(` - ${BACKSLASH}\n1. a`)).toBe(`- ${BACKSLASH}\n  1${BACKSLASH}. a\n`)
  })

  it('C2-W-026, C2-W-092: a line that starts inside an inline node and would open a block is escaped', () => {
    expect(format(' - ^[\n- ]')).toBe(`- ^[\n  ${BACKSLASH}- ]\n`)
    expect(format(' - /:\n1. a/')).toBe(`- /:\n  1${BACKSLASH}. a/\n`)
    expect(format('[^a]: /|\n- +/')).toBe(`[^a]: /|\n  ${BACKSLASH}- +/\n`)
  })

  it('C2-W-088: a content that opens a block on its own is probed behind a word', () => {
    expect(format(`/:: ${BACKSLASH}${BACKTICK}a/`)).toBe(`/:: ${BACKSLASH}${BACKTICK}a/\n`)
    expect(format(`{-${BACKSLASH}${BACKTICK}\n||-}`)).toBe(`{-${BACKSLASH}${BACKTICK}\n||-}\n`)
    expect(format(`${BACKSLASH}"*${BACKSLASH}${BACKTICK}u*`)).toBe(`${BACKSLASH}"*${BACKSLASH}${BACKTICK}u*\n`)
  })
})

describe('one UTF-8 width for positions, the layout record and the writer', () => {
  it('C2-W-067, C2-A-010: a continuation row behind an unpaired surrogate stays where the record puts it', () => {
    expect(format('| \ud800 |\n+ more |')).toBe('| \ud800 |\n+ more |\n')
    expect(format('| \ud800 a |\n+ more |')).toBe('| \ud800 a |\n+ more |\n')
    expect(format('| 😀 a |\n+ more |')).toBe('| 😀 a |\n+ more |\n')
  })

  it('C2-A-141: an unpaired surrogate is one column, as every code point is', () => {
    const second = (source: string): unknown => (parse(source).children[0] as unknown as Nested).children[1]!['pos']
    expect(second('\ud800a *b*')).toMatchObject({ startColumn: 4, startOffset: 5 })
    expect(second('😀a *b*')).toMatchObject({ startColumn: 4, startOffset: 6 })
  })
})

describe('folding and trimming keep the characters the specification keeps', () => {
  it('C2-I-079: a label folds and trims spaces, tabs and line breaks, and keeps a no-break space', () => {
    expect(render('[x][ r ]\n\n[r]: /u')).not.toContain('href')
    expect(render('[x][ r ]\n\n[ r ]: /u')).toBe('<p><a href="/u">x</a></p>')
    expect(render('[x][ r\n s ]\n\n[r s]: /u')).toBe('<p><a href="/u">x</a></p>')
    expect(foldLabel(' a \t\n b  ')).toBe('a b')
    expect(foldLabel(' a ')).toBe(' a ')
  })

  it('C2-B-084: the expansion of an abbreviation keeps a no-break space at its ends', () => {
    expect(parse('*[A]:  x ').children[0]).toMatchObject({ type: 'abbreviation_def', expansion: ' x ' })
    expect(parse('*[A]: x  ').children[0]).toMatchObject({ type: 'abbreviation_def', expansion: 'x' })
  })
})

describe('one walker over every slot that holds nodes', () => {
  const reference = { type: 'link', key: 'r', namespace: 'link', form: 'full', children: [{ type: 'text', value: 'x' }] }
  const definition = { type: 'link_reference_definition', key: 'r', namespace: 'link', href: '/u' }
  const supplied = (inline: unknown, ...more: unknown[]): DocumentNode => decodeTree(JSON.stringify({
    type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [inline] }, ...more],
  }))

  it('C2-A-024, C2-A-025: resolution reads a reference in a ruby base and in an extension fallback', () => {
    const ruby = { type: 'ruby', pairs: [{ type: 'rubyPair', base: [reference], annotation: [{ type: 'text', value: 'a' }] }] }
    expect(render(supplied(ruby, definition))).toBe('<p><ruby><a href="/u">x</a><rp>(</rp><rt>a</rt><rp>)</rp></ruby></p>')
    expect(render(supplied({ type: 'inline_extension', name: 'a.b', children: [], fallback: [reference] }, definition))).toBe('<p><a href="/u">x</a></p>')
  })

  it('C2-H-129: a profile filters the fallback of an extension, which the renderer writes', () => {
    const link = { type: 'link', href: '/u', children: [{ type: 'text', value: 'x' }] }
    expect(render(supplied({ type: 'inline_extension', name: 'a.b', children: [], fallback: [link] }), { profile: 'minimal' })).toBe('<p>x</p>')
  })

  it('C2-H-024, C2-L-011: numbers count in document order, so a footnote in a title comes before one in the body', () => {
    const html = render('::: note "T^[t]"\nb^[b]\n:::')
    expect(html.indexOf('fnref1')).toBeLessThan(html.indexOf('fnref2'))
    expect(html).toContain('T<a id="fnref1"')
  })

  it('C2-L-010: a pointer step of a named slot is encoded, and a token is decoded in the order RFC 6901 gives', () => {
    expect(pointerKey('a/b~c')).toBe('a~1b~0c')
    expect(pointerToken('a~1b~0c')).toBe('a/b~c')
    expect(pointerToken('~01')).toBe('~1')
    const slot = (name: string): unknown => ({ type: 'inline_extension', name: 'a.b', children: [], slots: { [name]: [{ type: 'paragraph', children: [] }] } })
    expect(refusal(inParagraph(slot('a/b')))).toBe('/children/0/children/0/slots/a~1b/0: paragraph does not stand here')
  })
})

describe('fields checked against the node type they stand on', () => {
  it('C2-A-103, C2-A-117, C2-A-170: a reference or a definition in the namespace of another node type is refused at decode', () => {
    const link = { type: 'link', key: 'r', namespace: 'footnote', form: 'full', children: [{ type: 'text', value: 'x' }] }
    expect(refusal(inParagraph(link))).toBe('/children/0/children/0/namespace: unknown value "footnote"')
    expect(refusal(inParagraph({ type: 'footnote_ref', key: 'n', namespace: 'link' }))).toBe('/children/0/children/0/namespace: unknown value "link"')
    expect(refusal(inParagraph({ type: 'abbreviation', key: 'A', namespace: 'heading' }))).toBe('/children/0/children/0/namespace: unknown value "heading"')
    const definition = { type: 'document', astVersion: '2.0', children: [{ type: 'link_reference_definition', key: 'r', namespace: 'abbr', href: '/u' }] }
    expect(refusal(definition)).toBe('/children/0/namespace: unknown value "abbr"')
    expect(refusal(inParagraph({ ...link, namespace: 'link' }))).toBeNull()
  })
})

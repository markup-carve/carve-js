// The cases of the three-way check of the 0.2 engines where the clause decides against this engine.
import { describe, expect, it } from 'vitest'
import { AST_VERSION, CarveTreeError, parse, parseWithDiagnostics, render, renderWithDiagnostics, validateTree } from '../src/index.ts'

const first = (src: string): Record<string, unknown> => {
  const { pos: _pos, ...rest } = parse(src).children[0] as unknown as Record<string, unknown>
  return rest
}
const findings = (src: string): string[] => parseWithDiagnostics(src).diagnostics.map((finding) => finding.code)

describe('C2-B-119/122/196: a sigil starts a sigil div also when further words are glued to it', () => {
  const SIGILS: [string, string][] = [['>', 'block_quote'], ['|', 'line_block'], ['\\', 'div']]
  const TAILS = ['a', '#', '>', '|', '\\', '{.x}', '{', '"t"', '[l]', ')', '*', 'x y', '%% c', '\ta']

  it('C2-B-119: every sigil with every kind of glued tail opens its sigil div', () => {
    for (const [sigil, type] of SIGILS) {
      for (const tail of TAILS) {
        const src = `::: ${sigil}${tail}\nq\n:::\n`
        expect(first(src)).toMatchObject({ type })
        expect(findings(src)).toEqual(['fence-title-syntax'])
      }
    }
    expect(first('::: \\a\nq\n:::\n')).toMatchObject({ type: 'div', attrs: { classes: ['hardbreaks'] } })
  })

  it('C2-B-122: a sigil div takes no title and no label, so both are further words and reported', () => {
    for (const [sigil, type] of SIGILS) {
      for (const rest of [' "T"', ' [l]', ' "T" [l]', ' w', '  w']) {
        const src = `::: ${sigil}${rest}\nq\n:::\n`
        expect(first(src)).toMatchObject({ type })
        expect(first(src)).not.toHaveProperty('title')
        expect(first(src)).not.toHaveProperty('groupLabel')
        expect(findings(src)).toEqual(['fence-title-syntax'])
      }
      expect(findings(`::: ${sigil}\nq\n:::\n`)).toEqual([])
      expect(findings(`::: ${sigil}  \nq\n:::\n`)).toEqual([])
    }
  })

  it('C2-B-119: Example 240, `::: >a` opens a quote fence and `::: *` an anonymous div', () => {
    expect(render('::: >a\nx\n:::\n\n::: *\ny\n:::')).toBe('<blockquote><p>x</p></blockquote>\n<div>\n  <p>y</p>\n</div>')
    expect(render('::: |#')).toBe('<div class="line-block">\n\n</div>')
  })

  it('C2-B-196: a sigil glued to the run is still text, and a line with further words never closes a div', () => {
    expect(first(':::>a\n')).toMatchObject({ type: 'paragraph' })
    expect(render('::: x\n::: |a\n:::\nb\n:::\n')).toBe('<div class="x">\n  <div class="line-block">\n\n  </div>\n  <p>b</p>\n</div>')
  })
})

describe('C2-I-118: the scan goes on behind an opener that failed at the cap', () => {
  // The children of the paragraph behind `open` braced openers that never close, without that prefix.
  const behind = (open: number, content: string): unknown => {
    const children = (parse(`${'{^'.repeat(open)}${content}`).children[0] as unknown as { children: { value?: string }[] }).children
    const head = children[0]!.value!.slice(open * 2)
    const rest = head === '' ? children.slice(1) : [{ ...children[0], value: head }, ...children.slice(1)]
    return JSON.parse(JSON.stringify(rest, (key, value: unknown) => key === 'pos' ? undefined : value))
  }

  it('C2-I-118: behind `^[`, `![` and `:name[` the next bracket is no footnote reference', () => {
    for (const opener of ['^[', '![', ':n[', ':ab-c[']) {
      expect(behind(200, `${opener}^x]`)).toEqual([{ type: 'text', value: `${opener}^x]` }])
    }
    expect(behind(200, '^[^"]')).toEqual([
      { type: 'text', value: '^[^' },
      { type: 'smart_punctuation', kind: 'right_double_quote', glyph: '”', source: '"' },
      { type: 'text', value: ']' },
    ])
  })

  it('C2-I-118: an opener that failed at the cap pairs with no closing bracket', () => {
    expect(JSON.stringify(behind(199, '[a ^[^x] b](u)'))).not.toContain('footnote_ref')
    expect(behind(199, '^[a ^[^x] b]')).toEqual([
      { type: 'inline_footnote', children: [{ type: 'text', value: 'a ^[^x' }], number: 1 }, { type: 'text', value: ' b]' },
    ])
  })
})

describe('C2-B-130: a line block keeps the spaces that lead a line after the content-column strip', () => {
  const lines = (src: string): unknown => {
    const values: string[] = []
    const walk = (node: { type: string, value?: string, children?: unknown[] }): void => {
      if (node.type === 'line') values.push((node.children ?? []).map((child) => (child as { value?: string }).value ?? '').join(''))
      else for (const child of node.children ?? []) walk(child as typeof node)
    }
    walk(parse(src) as unknown as { type: string })
    return values
  }

  it('C2-B-130: the indent of the opener is not stripped from a line (no C2-B-029 strip)', () => {
    expect(lines(' ::: |\n x\n :::\n')).toEqual([' x'])
    expect(lines('  ::: |\n   x\n y\n  :::\n')).toEqual(['   x', ' y'])
    expect(lines(' ::: |\n\tx\n :::\n')).toEqual(['\tx'])
    expect(render(' ::: |\n x\n :::\n')).toBe('<div class="line-block">\n  <p>&nbsp;x</p>\n</div>')
  })

  it('C2-B-027, C2-B-130: in an item only the content column is stripped', () => {
    expect(lines('- ::: |\n     x\n  :::\n')).toEqual(['   x'])
    expect(lines('- a\n\n  ::: |\n    x\n  :::\n')).toEqual(['  x'])
    expect(lines('- a\n\n    ::: |\n    x\n    :::\n')).toEqual(['  x'])
    expect(lines('-   a\n\n    ::: |\n      x\n    :::\n')).toEqual(['  x'])
    expect(lines('> - a\n>\n>   ::: |\n>    x\n>   :::\n')).toEqual([' x'])
    expect(lines('[^n]: ::: |\n        x\n      :::\n\n[^n]\n')).toEqual(['  x'])
  })

  it('C2-B-004 to C2-B-007, C2-B-130: a tab behind a quote mark leads the line and stays', () => {
    expect(lines('- > a\n  > \t::: |\n  > \tx\n  > \t:::\n')).toEqual(['\tx'])
    expect(lines('> \t::: |\n> \t x\n> \t:::\n')).toEqual(['\t x'])
  })
})

describe('C2-H-165: a degraded node that leaves no text is dropped', () => {
  it('C2-H-165: a degraded table of empty cells writes nothing, and its caption alone stays', () => {
    for (const table of ['|  |\n', '| |\n| |\n', '|= |\n']) {
      expect(render(table, { profile: 'minimal' })).toBe('')
    }
    expect(render('| |\n^ cap\n', { profile: 'minimal' })).toBe('<p>cap</p>')
    expect(render('| | |\n', { profile: 'minimal' })).toBe('<p> | </p>')
    expect(render('| a |\n|  |\n', { profile: 'minimal' })).toBe('<p>a<br>\n</p>')
  })
})

describe('C2-B-197: a block image line has the shape of the inline image form', () => {
  const kind = (line: string): string => {
    // C2-A-082: a block image takes the caption in its own slot.
    const node = first(`${line}\n^ cap\n`)
    if (node['caption'] === undefined) return String(node['type'])
    return node['role'] === 'image' ? 'figure' : 'figure without image'
  }
  const role = (line: string): unknown => first(`${line}\n`)['role']

  it('C2-I-076: a reference label runs to the next `]` and may hold `[`', () => {
    expect(kind('![a][b[c]')).toBe('figure')
    expect(role('![x][a[b]')).toBe('image')
    expect(kind('![a][b\\]c]')).toBe('figure')
    expect(kind('![a][b[c]d]')).toBe('paragraph')
    expect(kind('![a][b`]`]')).toBe('paragraph')
  })

  it('C2-I-078, C2-I-079: a blank label and one that starts with `@` or `^` are no labels', () => {
    for (const line of ['![a][ ]', '![a][\t]', '![a][@x]', '![a][^n]', '![ ][]', '![][]']) {
      expect(kind(line)).toBe('paragraph')
      expect(role(line)).toBeUndefined()
    }
    expect(kind('![a][]')).toBe('figure')
    expect(kind('![a][ @x]')).toBe('figure')
  })

  it('C2-I-024, C2-I-077: a line comment in the label leaves the form open, one in the alt ends before its bracket', () => {
    for (const line of ['![a][b %% c]', '![a [b %% c](x)']) expect(kind(line)).toBe('paragraph')
    for (const line of ['![a %% b](x)', '![a\t%% b](x)', '![a [b %% c] d](x)']) expect(kind(line)).toBe('figure')
    expect(kind('![a%%b](x)')).toBe('figure')
    expect(kind('![a][b%%c]')).toBe('figure')
  })

  it('C2-I-068, C2-I-069: only spaces stand between the title and `)`', () => {
    expect(kind('![i](a "t"\t)')).toBe('paragraph')
    expect(kind('![i](a "t"  )')).toBe('figure')
    expect(kind("![i](a 't')")).toBe('figure')
    expect(kind('![i](a\t"t")')).toBe('paragraph')
  })

  it('C2-I-006: the alt closes where the inline bracket stack closes it, behind the atoms of the line', () => {
    for (const line of [
      '![a `]` b](x)', '![a <h:x]> b](x)', '![a {% ] %} b](x)', '![a \\] b](x)', '![a [b] c](x)', '![a [b](u]v) c](x)',
      '![a [b][c[d] e](x)', '![a [b]{k="]"} c](x)', '![a [^n] b](x)', '![a ^[b] c](x)', '![a :n[b] c](x)', '![](x)',
    ]) {
      expect(kind(line)).toBe('figure')
    }
    for (const line of ['![a](x) b', '![a](x', '![a [b](x)', '![a](x)(y)', '![a]', '![a] (x)']) expect(kind(line)).toBe('paragraph')
  })
})

describe('C2-B-127: `figure` with no title and no label gives a figure group', () => {
  it('C2-B-122, C2-B-225: further words, glued or after a space, leave it a figure group and are reported', () => {
    for (const rest of ['/*x*/', ' x', '>', ' x y', '|', '\t', ' %% c']) {
      const src = `::: figure${rest}\n![a](a.png)\n:::\n`
      expect(first(src)).toMatchObject({ type: 'figure_group' })
      expect(findings(src)).toEqual(rest === '\t' ? [] : ['fence-title-syntax'])
    }
    expect(render('::: figure/*x*/\n![a](a.png)\n:::\n')).toBe('<figure class="carve-figure-group">\n  <img src="a.png" alt="a">\n</figure>')
  })

  it('C2-B-105: an attribute block on the opener is neither a title nor a label, and is not applied', () => {
    for (const rest of [' {#f}', '{#f}', '{.c} x']) {
      const src = `::: figure${rest}\n| x |\n:::\n`
      expect(first(src)).toMatchObject({ type: 'figure_group' })
      expect(first(src)).not.toHaveProperty('attrs')
    }
    expect(findings('::: figure{#f}\n| x |\n:::\n')).toEqual(['fence-opener-fallback'])
  })

  it('C2-B-127: with a title or a label it is a plain div with the class `figure`', () => {
    for (const rest of [' "T"', ' [l]', ' "T" [l]', '  "T"']) {
      expect(first(`::: figure${rest}\nq\n:::\n`)).toMatchObject({ type: 'div', attrs: { classes: ['figure'] } })
    }
  })
})

describe('C2-B-127, C2-A-084: a figure opener inside a group is a plain div and no panel', () => {
  it('C2-H-149: a caption line inside the group below that div is text and takes no number', () => {
    const src = '::: figure\n::: figure\n![a](a.png)\n^ (a) First\n:::\n^ Figure #: Both\n:::\n'
    expect(render(src)).toContain('<div class="figure">')
    expect(render(src)).toContain('<p>^ Figure #: Both</p>')
    expect(render(`${src}\n::: figure\n![b](b.png)\n^ (a) x\n:::\n^ Figure #: Next\n`)).toContain('<figcaption>Figure 1: Next</figcaption>')
    expect(render('::: figure\n![a](a.png)\n^ Figure #: Panel\n:::\n')).toContain('<figcaption>Figure #: Panel</figcaption>')
    expect(render('::: figure\n| x |\n^ Table #: Panel\n:::\n')).toContain('Table #: Panel')
  })
})

describe('C2-B-084: an abbreviation expansion keeps what follows the one space', () => {
  const expansion = (src: string): unknown => first(src)['expansion']

  it('C2-B-084: a leading space or tab stays in the expansion; the spaces and tabs that end the line do not', () => {
    expect(expansion('*[B]:  lead')).toBe(' lead')
    expect(expansion('*[B]: \tlead')).toBe('\tlead')
    expect(expansion('*[B]:   two  ')).toBe('  two')
    expect(expansion('*[B]: lead \t ')).toBe('lead')
    expect(expansion('*[B]: a  b')).toBe('a  b')
    expect(render('*[HTML]:  Hyper Text\n\nHTML')).toBe('<p><abbr title=" Hyper Text">HTML</abbr></p>')
    expect(render('*[HTML]: \tHyper Text\n\nHTML')).toBe('<p><abbr title="\tHyper Text">HTML</abbr></p>')
  })

  it('C2-B-084: with no expansion behind the one space the line is text', () => {
    for (const src of ['*[B]:', '*[B]: ', '*[B]:   ', '*[B]: \t', '*[B]:\tx']) expect(first(src)['type']).toBe('paragraph')
  })
})

describe('C2-A-049, C2-B-113: an unclosed frontmatter block keeps its trailing blank lines', () => {
  it('C2-B-163: the block runs to the end of the document, blank lines included', () => {
    expect(first('---\nx\n  ')).toMatchObject({ type: 'frontmatter', value: 'x\n  \n' })
    expect(first('---\nx\n\n')).toMatchObject({ type: 'frontmatter', value: 'x\n\n' })
    expect(first('---\nx\n\n\ny\n')).toMatchObject({ type: 'frontmatter', value: 'x\n\n\ny\n' })
    expect(first('---\nx\n\n---\n')).toMatchObject({ type: 'frontmatter', value: 'x\n\n' })
    expect(render('---\nx\n  ')).toBe('')
  })
})

describe('C2-B-171, C2-I-034: a cell prefix is the valid brace block, and an invalid glued block is content', () => {
  const cell = (row: string): Record<string, unknown> => {
    const table = parse(row).children[0] as unknown as { children: { children: { children: Record<string, unknown>[] }[] }[] }
    const { pos: _pos, ...rest } = table.children[0]!.children[0]!.children[0]!
    return JSON.parse(JSON.stringify(rest, (key, value: unknown) => key === 'pos' ? undefined : value)) as Record<string, unknown>
  }
  const text = (node: Record<string, unknown>): string => JSON.stringify(node['children']).replace(/.*"value":"([^"]*)".*/u, '$1')

  it('C2-I-034: the invalid block does not void the valid one before it', () => {
    expect(cell('|{c}{-}|')).toMatchObject({ attrs: { keyValues: [['c', '']] } })
    expect(text(cell('|{c}{-}|'))).toBe('{-}')
    expect(cell('|={.a}{-} x|')).toMatchObject({ header: true, attrs: { classes: ['a'] } })
    expect(text(cell('|={.a}{-} x|'))).toBe('{-} x')
    expect(cell('|{<}{-}|')).toMatchObject({})
    expect(render('|{c}{-}|')).toBe('<table>\n  <tbody>\n    <tr><td c="">{-}</td></tr>\n  </tbody>\n</table>')
  })

  it('C2-B-093: two valid glued blocks still merge, and an invalid first block leaves the cell without a prefix', () => {
    expect(cell('|{c}{.d} x|')).toMatchObject({ attrs: { classes: ['d'], keyValues: [['c', '']] } })
    expect(cell('|{-}{.d} x|')).not.toHaveProperty('attrs')
  })
})

describe('C2-B-043: a bare dot whose content starts with a dot and a space is no marker', () => {
  it('C2-B-043: the content starts at the first content character, whatever the spaces before it', () => {
    for (const src of ['. . a', '.  . a', '.   . a', '. \t. a', '.{.c} . a', '.{.c}  . a', '. . . and then silence']) {
      expect(first(src)['type']).toBe('paragraph')
    }
    expect(render('.  . a')).toBe('<p>.  . a</p>')
    for (const src of ['.  a', '.  .a', '. .', '1.  . a']) expect(first(src)['type']).toBe('list')
  })
})

describe('C2-H-024: authored ids are reserved first, also that of an unresolved reference', () => {
  it('C2-H-024: the heading takes the suffix, and the reference writes its block as text (C2-I-085)', () => {
    expect(render('[x][y]{#i}\n\n# i')).toBe('<p>[x][y]{#i}</p>\n<section id="i-2">\n  <h1>i</h1>\n</section>')
    expect(render('![x][y]{#i}\n\n# i')).toContain('<section id="i-2">')
    expect(render('[x][]{#i}\n\n# i')).toContain('<section id="i-2">')
  })

  it('C2-A-039: a later node with the same id is reported, whatever the node type', () => {
    expect(findings('[x][y]{#i}\n\n{#i}\nb')).toContain('duplicate-id')
  })
})

describe('C2-I-033: a quoted value may hold the other quote and a closing brace', () => {
  it('C2-B-090: such a block is an attribute line, and the same holds in every block prefix', () => {
    expect(render('{x=\'"\'}\na')).toBe('<p x="&quot;">a</p>')
    expect(render('{x="\'"}\na')).toBe('<p x="&apos;">a</p>')
    expect(render('{x=\'}"\'}\na')).toBe('<p x="}&quot;">a</p>')
    expect(render('{x=\'a\\\'b\'}\na')).toBe('<p x="a&apos;b">a</p>')
    expect(first('-{x=\'"\'} b')).toMatchObject({ type: 'list', children: [{ attrs: { keyValues: [['x', '"']] } }] })
    expect(render('|{x=\'"\'} a|')).toContain('<td x="&quot;">a</td>')
    expect(render('| a |{x=\'"\'}')).toContain('<tr x="&quot;">')
    expect(first('![a](u){x=\'"\'}\n^ c')).toMatchObject({ type: 'paragraph', role: 'image', caption: { type: 'caption' } })
    expect(first("{x='a}\nb")).not.toHaveProperty('attrs')
  })
})

describe('C2-H-016, C2-H-166: a kept `<li>` carries `data-source-line`', () => {
  it('C2-H-166: an item past the bound keeps its `<li>` and the source line of the item', () => {
    const options = { profile: 'minimal', sourceLines: true } as const
    expect(render('- - -C2-A-034', options)).toBe(
      '<ul data-source-line="1">\n  <li data-source-line="1">\n    <ul data-source-line="1">\n      <li data-source-line="1">-C2-A-034</li>\n'
      + '    </ul>\n  </li>\n</ul>',
    )
    expect(render('- a\n- - # h\n  - b', options)).toContain('<li data-source-line="3">b</li>')
    expect(render('- - a', { profile: 'minimal' })).toContain('<li>a</li>')
  })
})

describe('C2-H-051: the carrier of a raw span stands only around the escaped payload', () => {
  it('C2-H-051, C2-H-053, C2-H-054: verbatim with `rawHtml`, escaped in the carrier without it, nothing for another format', () => {
    const src = '`<b>x</b>`{=html}'
    expect(render(src, { roundtrip: true })).toBe('<p><span data-carve-raw="html">&lt;b&gt;x&lt;/b&gt;</span></p>')
    expect(render(src, { roundtrip: true, rawHtml: true })).toBe('<p><b>x</b></p>')
    expect(render(src, { rawHtml: true })).toBe('<p><b>x</b></p>')
    expect(render(src)).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
    expect(render('`x`{=latex}', { roundtrip: true })).toBe('<p></p>')
    expect(renderWithDiagnostics('`x`{=latex}', { roundtrip: true }).diagnostics.map((d) => d.code)).toEqual(['raw-format-dropped'])
  })
})

describe('C2-I-118: the open entries of both stacks count when an opener is read', () => {
  // The inline children of the first paragraph behind `open` unpaired star openers, as `type` or `type(children)`.
  const leaf = (open: number, content: string): string => {
    const node = parse(`${'*a '.repeat(open)}${content}`).children[0] as unknown as { children: { type: string }[] }
    const show = (child: { type: string, value?: string, children?: unknown[] }): string =>
      child.type === 'text' ? JSON.stringify(child.value) : `${child.type}(${(child.children ?? []).map((c) => show(c as typeof child)).join(' ')})`
    const shown = node.children.map(show).join(' ')
    return shown.replace(`"${'*a '.repeat(open)}`, '"').replace(/^"" /, '')
  }
  const brackets = (open: number, content: string): string => render(`${'['.repeat(open)}${content}`)

  it('C2-I-118: an opening bracket counts the open delimiter entries', () => {
    expect(leaf(198, ':n[[]')).toBe('":n[[]"')
    expect(leaf(199, ':n[[]')).toBe('inline_extension("[")')
    expect(leaf(199, '[x](u)')).toBe('link("x")')
    expect(leaf(200, '[x](u)')).toBe('"[x](u)"')
  })

  it('C2-I-118: a delimiter opener counts the open brackets', () => {
    expect(brackets(199, '*a*')).toContain('<strong>a</strong>')
    expect(brackets(200, '*a*')).not.toContain('<strong>')
    expect(brackets(199, '{^a^}')).toContain('<sup>a</sup>')
    expect(brackets(200, '{^a^}')).not.toContain('<sup>')
  })

  it('C2-I-118: a closed construct leaves the count, with the entries inside it', () => {
    expect(leaf(199, '[x](u) [y](v)')).toBe('link("x") " " link("y")')
    expect(leaf(198, '[*b](u) *c [y](v)')).toBe('link("*b") " *c " link("y")')
    // A pair that forms no construct bounds nothing: the star inside it stays open.
    expect(leaf(198, '[*b] *c [y](v)')).toBe('"[*b] *c [y](v)"')
  })
})

describe('C2-A-181: the `code` option of an include is a syntax string or true', () => {
  const tree = (code: unknown): unknown => ({
    type: 'document', astVersion: AST_VERSION, children: [{ type: 'include', path: 'data.csv', options: { code } }],
  })

  it('C2-A-181: an empty string and one with characters outside a language word are rejected', () => {
    for (const code of ['', 'a b', 'js}', 1]) expect(() => validateTree(tree(code))).toThrow(CarveTreeError)
    for (const code of [true, 'js', 'c++', 'x/y.z#1_A']) expect(() => validateTree(tree(code))).not.toThrow()
  })
})

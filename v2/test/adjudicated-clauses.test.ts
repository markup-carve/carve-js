// The cases of the three-way check of the 0.2 engines where the clause decides against this engine.
import { describe, expect, it } from 'vitest'
import { parse, parseWithDiagnostics, render } from '../src/index.ts'

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

describe('C2-I-118/126: the scan goes on behind an opener that failed at the cap', () => {
  const innermost = (src: string): unknown => {
    let node = parse(src).children[0] as unknown as { type: string, children: unknown[] }
    while (node.type === 'block_quote') node = node.children[0] as typeof node
    return JSON.parse(JSON.stringify(node.children, (key, value: unknown) => key === 'pos' ? undefined : value))
  }

  it('C2-I-118: behind `^[`, `![` and `:name[` the next bracket is no footnote reference', () => {
    for (const opener of ['^[', '![', ':n[', ':ab-c[']) {
      const children = innermost(`${'> '.repeat(200)}${opener}^x]`)
      expect(children).toEqual([{ type: 'text', value: `${opener}^x]` }])
    }
    expect(innermost(`${'> '.repeat(200)}^[^"]`)).toEqual([
      { type: 'text', value: '^[^' },
      { type: 'smart_punctuation', kind: 'right_double_quote', glyph: '”', source: '"' },
      { type: 'text', value: ']' },
    ])
  })

  it('C2-I-126: an opener that failed at the cap pairs with no closing bracket', () => {
    const children = innermost(`${'> '.repeat(199)}[a ^[^x] b](u)`)
    expect(JSON.stringify(children)).not.toContain('footnote_ref')
    expect(innermost(`${'> '.repeat(199)}^[a ^[^x] b]`)).toEqual([
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
    const node = first(`${line}\n^ cap\n`)
    if (node['type'] !== 'figure') return String(node['type'])
    const inner = (node['children'] as { role?: string }[])[0]!
    return inner.role === 'image' ? 'figure' : 'figure without image'
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

  it('C2-I-024, C2-I-077: a line comment in the alt or the label leaves the form open', () => {
    for (const line of ['![a][b %% c]', '![a %% b](x)', '![a\t%% b](x)', '![a [b %% c] d](x)']) {
      expect(kind(line)).toBe('paragraph')
    }
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

describe('C2-H-149, C2-A-084: a figure group nested in a group is no panel', () => {
  it('C2-H-149: the caption of a nested figure group takes the next number of its key', () => {
    const src = '::: figure\n::: figure\n![a](a.png)\n^ (a) First\n:::\n^ Figure #: Both\n:::\n'
    expect(render(src)).toContain('<figcaption>Figure 1: Both</figcaption>')
    expect(render(`${src}\n::: figure\n![b](b.png)\n^ (a) x\n:::\n^ Figure #: Next\n:::\n`)).toContain('<figcaption>Figure 2: Next</figcaption>')
    expect(render('::: figure\n![a](a.png)\n^ Figure #: Panel\n:::\n')).toContain('<figcaption>Figure #: Panel</figcaption>')
    expect(render('::: figure\n| x |\n^ Table #: Panel\n:::\n')).toContain('Table #: Panel')
  })
})

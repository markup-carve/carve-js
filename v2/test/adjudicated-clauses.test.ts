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

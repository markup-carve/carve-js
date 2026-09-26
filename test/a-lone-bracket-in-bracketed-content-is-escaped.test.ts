import { describe, expect, it, vi } from 'vitest'

const parsed = vi.hoisted(() => ({ bytes: 0 }))
vi.mock('../src/parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parse.js')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      parsed.bytes += args[0].length
      return actual.parse(...args)
    },
  }
})

const { carveToCarve, carveToHtml, htmlToCarve, renderCarve, RenderDepthError } = await import('../src/index.js')
const { expectScansLinearly, perfIt } = await import('./helpers/scaling.js')
const { collectLoneBrackets } = await import('../src/bracket-escapes.js')

const roundTrips = (html: string, expected: string): void => {
  const out = htmlToCarve(html).value
  expect(out).toBe(`${expected}\n`)
  expect(carveToCarve(out)).toBe(out)
}

describe('PART 11 §5 lone brackets in bracketed content', () => {
  it.each([
    ['<span class="b">[</span>', '[\\[]{.b}'],
    ['<span class="b">]</span>', '[\\]]{.b}'],
    ['<a href="/y">a ] b [ c</a>', '[a \\] b \\[ c](/y)'],
    ['<span class="c">[x]</span>', '[[x]]{.c}'],
    ['<a href="/y">see [1] here</a>', '[see [1] here](/y)'],
    ['<span class="c">a <em>[</em> b ]</span>', '[a /[/ b ]]{.c}'],
    ['<span class="c">[ <a href="/u">x</a></span>', '[\\[ [x](/u)]{.c}'],
    ['<span class="c"><code>[</code> ]</span>', '[`[` \\]]{.c}'],
    ['<span class="c"><ruby>[<rt>x</rt></ruby>]</span>', '[[(x)]]{.c}'],
  ])('writes %s as %s', (html, expected) => {
    roundTrips(`<p>${html}</p>`, expected)
  })

  it('leaves a bracket outside every bracketed construct bare', () => {
    roundTrips('<p>a [ b and c ] d</p>', 'a [ b and c ] d')
  })

  it('pairs a long run of openers without overflowing the stack', () => {
    const run = '['.repeat(150_000)
    const out = htmlToCarve(`<p><span class="c">${run}</span></p>`).value
    expect(out.startsWith('[\\[\\[')).toBe(true)
  })

  it('reports a deep tree as too deep rather than overflowing the stack', () => {
    for (const type of ['span', 'insert']) {
      let inner: { type: string; children: unknown[] } = { type, children: [{ type: 'text', value: 'x' }] }
      for (let i = 0; i < 10_000; i++) inner = { type, children: [inner] }
      const doc = { type: 'document', children: [{ type: 'paragraph', children: [inner] }] }
      expect(() => renderCarve(doc as never)).toThrow(RenderDepthError)
    }
  })

  it('keeps the escape the author wrote', () => {
    expect(carveToCarve('[\\[]{.b}\n')).toBe('[\\[]{.b}\n')
  })

  it('writes a page of edit markers without the narrowing search', () => {
    const html =
      '<body>' +
      Array.from({ length: 200 }, (_, i) => `<h2>Part ${i}<span class="e">[</span><a href="/e${i}">edit</a><span class="e">]</span></h2>`).join('') +
      '</body>'
    parsed.bytes = 0
    const out = htmlToCarve(html).value
    // One parse of the minimal form settles it; the search re-parsed the page
    // many times over.
    expect(parsed.bytes / out.length).toBeLessThan(3)
    expect(out).toContain('## Part 7[\\[]{.e}[edit](/e7)[\\]]{.e}\n')
    expect(carveToHtml(out)).toBe(carveToHtml(carveToCarve(out)))
  })
})

describe('PART 11 §5 destination parens across nodes', () => {
  it('pairs a bracket across emphasis', () => {
    roundTrips('<p>[a <strong>b</strong>](c)</p>', '[a *b*]\\(c)')
  })

  it('stays bare where an emphasis delimiter sits between bracket and paren', () => {
    roundTrips('<p><em>[a]</em>(b)</p>', '/[a]/(b)')
  })

  it('stays bare where the bracket pairs inside a nested construct only', () => {
    roundTrips('<p><a href="/u">[a</a>](b)</p>', '[\\[a](/u)](b)')
  })

  perfIt('scans a line of literal destinations in linear time', () => {
    for (const unit of ['[](x) ', '[](x)']) {
      expectScansLinearly((input) => void htmlToCarve(`<p>${input}</p>`), unit, {
        label: `literal destinations ${JSON.stringify(unit)}`,
        smallRepeats: 2000,
      })
    }
  })
})

describe('PART 11 §5 a run holding an empty code span', () => {
  const text = (value: string) => ({ type: 'text' as const, value })
  const code = { type: 'code' as const, value: '' }
  const selected = (children: unknown[]) => {
    const lone = new WeakMap<object, Set<number>>()
    const leftToSearch = new WeakSet<object>()
    const span = { type: 'span', children }
    collectLoneBrackets([span] as never, false, lone, leftToSearch)
    return (children as object[]).flatMap((node) => {
      const texts = 'children' in node ? (node as { children: object[] }).children : [node]
      return texts.map((t) => ({ lone: [...(lone.get(t) ?? [])], searched: leftToSearch.has(t) }))
    })
  }

  it('selects no bracket before or after the span', () => {
    expect(selected([text('a [ b '), code, text(' c ] d ]')])).toEqual([
      { lone: [], searched: true },
      { lone: [], searched: false },
      { lone: [], searched: true },
    ])
  })

  it('selects no bracket when the span sits inside emphasis', () => {
    const emphasis = { type: 'emphasis', children: [text('c '), code] }
    expect(selected([text('a [ b '), emphasis, text(' d ]')])).toEqual([
      { lone: [], searched: true },
      { lone: [], searched: true },
      { lone: [], searched: false },
      { lone: [], searched: true },
    ])
  })

  it('leaves the destination paren before the span to the search', () => {
    roundTrips('<p>x [a](b) y <code></code></p>', 'x \\[a](b) y ``')
    roundTrips('<p>x [a](b) y <em>z <code></code></em></p>', 'x \\[a](b) y {/z ``/}')
  })

  it('keeps both halves in a nested construct, a run of its own', () => {
    roundTrips('<p><span class="c">a ] b</span> <code></code></p>', '[a \\] b]{.c} ``')
  })
})

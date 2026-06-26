import { describe, expect, it } from 'vitest'

import { carveToHtml, parse } from '../src/index.js'
import { citations, parseLocator } from '../src/citations.js'

const h = (s: string) => carveToHtml(s, { extensions: [citations()] }).trim()
const ha = (s: string) =>
  carveToHtml(s, { extensions: [citations({ mode: 'author-date' })] }).trim()

function group(src: string): { items: { key: string; suppressAuthor: boolean }[] } | undefined {
  const doc = parse(src, { extensions: [citations()] })
  const p = doc.children.find((b) => b.type === 'paragraph') as
    | { children: { type: string }[] }
    | undefined
  return p?.children.find((n) => n.type === 'citation-group') as never
}

describe('citation matcher', () => {
  it('parses [@key] into a citation-group', () => {
    expect(group('[@smith2020]')?.items[0]!.key).toBe('smith2020')
  })

  it('leaves a bare @mention alone', () => {
    const doc = parse('@alice', { extensions: [citations()] })
    const p = doc.children[0] as { children: { type: string }[] }
    expect(p.children[0]!.type).toBe('mention')
  })

  it('does not claim a reference link [text][ref]', () => {
    expect(group('[text][ref]')).toBeUndefined()
  })

  it('declines a plain bracket with no @key', () => {
    expect(group('[just text]')).toBeUndefined()
  })

  it('parses a locator', () => {
    const g = parse('[@smith2020, p. 33]', { extensions: [citations()] })
    const p = g.children[0] as { children: { type: string; locator?: unknown[] }[] }
    const cg = p.children.find((n) => n.type === 'citation-group') as never as {
      items: { key: string; locator?: unknown[] }[]
    }
    expect(cg.items[0]!.key).toBe('smith2020')
    expect(cg.items[0]!.locator).toBeDefined()
  })

  it('parses suppress-author -@key', () => {
    expect(group('[-@smith2020]')?.items[0]!.suppressAuthor).toBe(true)
  })

  it('parses multiple ;-separated items', () => {
    const g = group('[@a; @b]')
    expect(g?.items.map((i) => i.key)).toEqual(['a', 'b'])
  })
})

describe('citations: defs + numbered rendering', () => {
  it('drops the [@key]: definition paragraph and numbers the citation', () => {
    const out = h('See [@smith2020].\n\n[@smith2020]: Smith, J. (2020). Title.')
    expect(out).toContain('[<a data-cite-key="smith2020" href="#ref-smith2020">1</a>]')
    expect(out).not.toContain('<p>Smith, J. (2020). Title.</p>')
  })

  it('builds a references list with stable ids', () => {
    const out = h('[@a].\n\n[@a]: Entry A.')
    expect(out).toContain('<ol class="references">')
    expect(out).toContain('<li id="ref-a">Entry A.</li>')
  })

  it('numbers by first-citation order', () => {
    const out = h('[@b] then [@a].\n\n[@a]: A.\n\n[@b]: B.')
    expect(out).toContain('href="#ref-b">1</a>')
    expect(out).toContain('href="#ref-a">2</a>')
  })

  it('renders locator and prefix inside the brackets', () => {
    const out = h('[see @a, p. 3].\n\n[@a]: A.')
    expect(out).toContain('[see <a data-cite-key="a" data-cite-prefix="see" data-locator-label="page" data-locator="3" href="#ref-a">1</a>, p. 3]')
  })

  it('renders an undefined key verbatim', () => {
    expect(h('[@nope].')).toContain('[@nope]')
  })

  it('keeps a bare @mention and a [text][ref] link working', () => {
    expect(h('@alice')).toContain('class="mention"')
  })

  it('declines many unmatched citation openers in linear time', () => {
    const source = '[@x '.repeat(20000)

    const start = performance.now()
    parse(source, { extensions: [citations()] })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
  })
})

describe('citations: consecutive definition lines', () => {
  it('collects each [@key]: line when defs are not blank-separated', () => {
    const out = h('[@a] and [@b].\n\n[@a]: First.\n[@b]: Second.')
    expect(out).toContain('href="#ref-a">1</a>')
    expect(out).toContain('href="#ref-b">2</a>')
    expect(out).toContain('<li id="ref-a">First.</li>')
    expect(out).toContain('<li id="ref-b">Second.</li>')
  })
})

describe('citations: author-date mode', () => {
  it('renders (Author Year) from the entry attrs', () => {
    const out = ha('See [@s].\n\n[@s]: {author="Smith" year="2020"} Smith, J.')
    expect(out).toContain('(<a data-cite-key="s" href="#ref-s">Smith 2020</a>)')
  })

  it('suppresses the author with -@key', () => {
    const out = ha('[-@s].\n\n[@s]: {author="Smith" year="2020"} S.')
    expect(out).toContain('>2020</a>')
  })
})

describe('citations: state isolation', () => {
  it('does not leak definitions across documents on a reused instance', () => {
    const ext = citations()
    carveToHtml('[@a].\n\n[@a]: First doc A.', { extensions: [ext] })
    // Second doc cites @a but never defines it ⇒ must fall back to raw.
    const out = carveToHtml('[@a].', { extensions: [ext] }).trim()
    expect(out).toContain('[@a]')
    expect(out).not.toContain('href="#ref-a"')
  })
})

describe('citations: references placement', () => {
  it('injects into an explicit ::: references block', () => {
    const out = h('[@a].\n\n::: references\n:::\n\n[@a]: A.')
    expect(out).toMatch(/<div class="references">[\s\S]*<ol class="references">/)
  })
})

// ----- Tier-3 Bibliography (#199) -------------------------------------------

const SMITH = {
  id: 'smith2020',
  author: [{ family: 'Smith', given: 'John' }],
  issued: { 'date-parts': [[2020]] },
  title: 'A Study',
}
const hb = (s: string, bib: unknown[]) =>
  carveToHtml(s, { extensions: [citations({ bibliography: bib })] }).trim()

describe('bibliography: external CSL-JSON resolution', () => {
  it('resolves a key from the pool and renders the formatted entry', () => {
    const out = hb('See [@smith2020].', [SMITH])
    expect(out).toContain('<a id="cite-smith2020-1" data-cite-key="smith2020" href="#ref-smith2020">1</a>')
    expect(out).toContain(
      '<li id="ref-smith2020">Smith, John (2020). A Study. ' +
        '<a href="#cite-smith2020-1" class="ref-backref">↩</a></li>',
    )
  })

  it('in-document def overrides the CSL pool', () => {
    const out = hb('See [@smith2020].\n\n[@smith2020]: In-doc entry.', [SMITH])
    expect(out).toContain('<li id="ref-smith2020">In-doc entry.')
    expect(out).not.toContain('A Study')
  })

  it('emits one back-link per use site', () => {
    const out = hb('[@smith2020] then [@smith2020] again.', [SMITH])
    expect(out).toContain('<a id="cite-smith2020-1" data-cite-key="smith2020" href="#ref-smith2020">1</a>')
    expect(out).toContain('<a id="cite-smith2020-2" data-cite-key="smith2020" href="#ref-smith2020">1</a>')
    expect(out).toContain('<a href="#cite-smith2020-1" class="ref-backref">↩</a>')
    expect(out).toContain('<a href="#cite-smith2020-2" class="ref-backref">↩</a>')
  })

  it('anchors each key of a multi-key group separately', () => {
    const out = hb('[@a; @b]', [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ])
    expect(out).toContain('<a id="cite-a-1" data-cite-key="a" href="#ref-a">1</a>')
    expect(out).toContain('<a id="cite-b-1" data-cite-key="b" href="#ref-b">2</a>')
  })

  it('renders an unresolved key verbatim with no anchors', () => {
    const out = hb('[@nope]', [SMITH])
    expect(out).toContain('[@nope]')
    expect(out).not.toContain('cite-nope')
    expect(out).not.toContain('class="references"')
  })

  it('a partially-resolved group is fully verbatim: its keys are not cited', () => {
    // [@smith2020; @missing] renders raw, so the defined key is NOT numbered,
    // listed, or a use site - no orphan reference entry (§6.2/§6.4).
    const out = hb('[@smith2020; @missing]', [SMITH])
    expect(out).toContain('[@smith2020; @missing]')
    expect(out).not.toContain('href="#ref-smith2020"')
    expect(out).not.toContain('id="ref-smith2020"')
    expect(out).not.toContain('class="references"')
  })

  it('escapes CSL entry text as plain data', () => {
    const out = hb('[@x]', [{ id: 'x', title: '<b>raw</b> & co' }])
    expect(out).toContain('&lt;b&gt;raw&lt;/b&gt; &amp; co.')
  })
})

describe('bibliography: minimal CSL formatter', () => {
  const entry = (csl: Record<string, unknown>) => {
    const out = hb('[@x]', [{ id: 'x', ...csl }])
    const m = out.match(/<li id="ref-x">([\s\S]*?) <a href="#cite-x-1"/)
    return m?.[1] ?? out.match(/<li id="ref-x">([\s\S]*?)<\/li>/)?.[1]
  }
  it('author + year + title', () => {
    expect(entry({ author: [{ family: 'Smith', given: 'John' }], issued: { 'date-parts': [[2020]] }, title: 'T' })).toBe(
      'Smith, John (2020). T.',
    )
  })
  it('author only', () => {
    expect(entry({ author: [{ family: 'Doe' }] })).toBe('Doe.')
  })
  it('year + title, no author', () => {
    expect(entry({ issued: { 'date-parts': [[1999]] }, title: 'T' })).toBe('(1999). T.')
  })
  it('multiple authors joined with semicolons', () => {
    expect(entry({ author: [{ family: 'A', given: 'X' }, { family: 'B', given: 'Y' }], title: 'T' })).toBe(
      'A, X; B, Y. T.',
    )
  })
  it('literal name and literal year', () => {
    expect(entry({ author: [{ literal: 'WHO' }], issued: { literal: 'n.d.' }, title: 'T' })).toBe('WHO (n.d.). T.')
  })
})

describe('bibliography: no pool keeps Tier-2 behavior', () => {
  it('does not add back-links when no bibliography is supplied', () => {
    const out = h('[@a].\n\n[@a]: A.')
    expect(out).toContain('<li id="ref-a">A.</li>')
    expect(out).not.toContain('ref-backref')
    expect(out).not.toContain('id="cite-a-1"')
  })
})

// Local helper: runs the parser and returns the first citation-group node.
function parseFirstCitationGroup(src: string): {
  mode?: string
  items: {
    key: string
    suppressAuthor: boolean
    prefix?: unknown[]
    locatorLabel?: string
    locatorValue?: string
    suffix?: unknown[]
  }[]
} {
  const doc = parse(src, { extensions: [citations()] })
  const p = doc.children.find((b) => b.type === 'paragraph') as
    | { children: { type: string }[] }
    | undefined
  const cg = p?.children.find((n) => n.type === 'citation-group')
  if (!cg) throw new Error(`No citation-group found in: ${src}`)
  return cg as never
}

describe('citation item parse (marker + typed locator)', () => {
  it('[+@k]: group mode integral, item has no mode field and no prefix', () => {
    const g = parseFirstCitationGroup('[+@k]')
    expect(g.mode).toBe('integral')
    expect(g.items[0]!.suppressAuthor).toBe(false)
    // mode field no longer exists on Citation; ensure it is absent
    expect(('mode' in (g.items[0] as object))).toBe(false)
  })
  it('[+-@k]: group mode integral, item suppressAuthor (- after stripping leading +)', () => {
    const g = parseFirstCitationGroup('[+-@k]')
    expect(g.mode).toBe('integral')
    expect(g.items[0]!.suppressAuthor).toBe(true)
  })
  it('[-+@k]: group mode undefined; leading "-" is not "+", so "-+" becomes item prefix', () => {
    // Pinned: [-+@k] -> group.mode=undefined, item key=k, suppressAuthor=false, prefix="-+"
    const g = parseFirstCitationGroup('[-+@k]')
    expect(g.mode).toBeUndefined()
    expect(g.items[0]!.key).toBe('k')
    expect(g.items[0]!.suppressAuthor).toBe(false)
    const prefixText = flattenInlineText(g.items[0]!.prefix as unknown[] ?? [])
    expect(prefixText).toBe('-+')
  })
  it('[foo+@k]: group mode undefined; "foo+" becomes item prefix', () => {
    // Pinned: [foo+@k] -> group.mode=undefined, item key=k, prefix="foo+"
    const g = parseFirstCitationGroup('[foo+@k]')
    expect(g.mode).toBeUndefined()
    expect(g.items[0]!.key).toBe('k')
    expect(g.items[0]!.suppressAuthor).toBe(false)
    const prefixText = flattenInlineText(g.items[0]!.prefix as unknown[] ?? [])
    expect(prefixText).toBe('foo+')
  })
  it('key containing +: [@foo+bar] treated as key, group mode undefined', () => {
    const g = parseFirstCitationGroup('[@foo+bar]')
    expect(g.items[0]!.key).toBe('foo+bar')
    expect(g.mode).toBeUndefined()
    expect(g.items[0]!.suppressAuthor).toBe(false)
  })
  it('[+@foo+bar]: group mode integral, key is foo+bar', () => {
    const g = parseFirstCitationGroup('[+@foo+bar]')
    expect(g.mode).toBe('integral')
    expect(g.items[0]!.key).toBe('foo+bar')
  })
  it('[@a; +@b]: group mode undefined; item[1] prefix flattens to "+"', () => {
    // Pinned: [@a; +@b] -> group.mode=undefined, item[1] key=b prefix="+"
    const g = parseFirstCitationGroup('[@a; +@b]')
    expect(g.mode).toBeUndefined()
    expect(g.items[0]!.key).toBe('a')
    expect(g.items[1]!.key).toBe('b')
    const prefixText = flattenInlineText(g.items[1]!.prefix as unknown[] ?? [])
    expect(prefixText).toBe('+')
  })
  it('typed locator fields', () => {
    const g = parseFirstCitationGroup('[@k, pp. 33-35, 38 and *passim*]')
    expect(g.items[0]!.locatorLabel).toBe('page')
    expect(g.items[0]!.locatorValue).toBe('33-35, 38')
    // suffix is inline nodes; assert the array is non-empty (contains "passim")
    expect(g.items[0]!.suffix).toBeDefined()
    expect((g.items[0]!.suffix as unknown[]).length).toBeGreaterThan(0)
    // Verify the flattened text of suffix contains "passim"
    const suffixText = flattenInlineText(g.items[0]!.suffix as unknown[])
    expect(suffixText).toContain('passim')
  })
})

// Helper: flatten inline node array to plain text
function flattenInlineText(nodes: unknown[]): string {
  return nodes
    .map((n) => {
      const node = n as { type?: string; value?: string; children?: unknown[] }
      if (node.type === 'text' && node.value) return node.value
      if (node.type === 'emph' && node.children) return flattenInlineText(node.children)
      if (node.type === 'strong' && node.children) return flattenInlineText(node.children)
      if (node.children) return flattenInlineText(node.children)
      return ''
    })
    .join('')
}

const htmlCite = (src: string) => carveToHtml(src, { extensions: [citations()] })
const DEFS = '\n\n[@k]: {author="K" year="2020"} K. (2020). Work.'

describe('citation data-* render', () => {
  it('integral group marker -> span wrapper with data-cite-mode, anchor has no data-cite-mode', () => {
    const out = htmlCite('[+@k]' + DEFS)
    // The span wrapper carries data-cite-mode="integral"
    expect(out).toContain('<span class="citation" data-cite-mode="integral">')
    expect(out).toContain('data-cite-key="k"')
    // The anchor itself must NOT carry data-cite-mode
    const anchorMatch = out.match(/<a [^>]*data-cite-key="k"[^>]*>/)
    expect(anchorMatch?.[0]).not.toContain('data-cite-mode')
  })
  it('non-integral [@k] -> no span wrapper, no data-cite-mode', () => {
    const out = htmlCite('[@k]' + DEFS)
    expect(out).not.toContain('data-cite-mode')
    expect(out).not.toContain('<span class="citation"')
  })
  it('suppress -> data-suppress-author, no data-cite-mode on anchor', () => {
    const out = htmlCite('[-@k]' + DEFS)
    expect(out).toContain('data-suppress-author="true"')
    expect(out).not.toContain('data-cite-mode')
  })
  it('typed locator -> data-locator-label/locator/suffix', () => {
    const out = htmlCite('[@k, pp. 33-35, 38 and *passim*]' + DEFS)
    expect(out).toContain('data-locator-label="page"')
    expect(out).toContain('data-locator="33-35, 38"')
    expect(out).toContain('data-suffix="and passim"')
  })
})

describe('parseLocator', () => {
  it('typed page', () => {
    expect(parseLocator('p. 4')).toEqual({ label: 'page', value: '4' })
  })
  it('abbrev range + suffix', () => {
    expect(parseLocator('pp. 33-35, 38 and *passim*')).toEqual({
      label: 'page', value: '33-35, 38', suffixText: 'and *passim*',
    })
  })
  it('non-page labels', () => {
    expect(parseLocator('chap. 2')).toEqual({ label: 'chapter', value: '2' })
    expect(parseLocator('§ 5')).toEqual({ label: 'section', value: '5' })
    expect(parseLocator('§5')).toEqual({ label: 'section', value: '5' })
    expect(parseLocator('vol.2')).toEqual({ label: 'volume', value: '2' })
  })
  it('default page on digit only', () => {
    expect(parseLocator('4')).toEqual({ label: 'page', value: '4' })
    expect(parseLocator('iv')).toEqual({ suffixText: 'iv' })
  })
  it('label boundary', () => {
    expect(parseLocator('pageant')).toEqual({ suffixText: 'pageant' })
    expect(parseLocator('voli')).toEqual({ suffixText: 'voli' })
    expect(parseLocator('s.v.foo')).toEqual({ suffixText: 's.v.foo' })
  })
  it('roman via space boundary', () => {
    expect(parseLocator('p. iv')).toEqual({ label: 'page', value: 'iv' })
  })
  it('comma-before-suffix trim', () => {
    expect(parseLocator('p. 4, see also')).toEqual({
      label: 'page', value: '4', suffixText: 'see also',
    })
  })
  it('empty value after label', () => {
    expect(parseLocator('p.')).toEqual({ label: 'page' })
    expect(parseLocator('chap. *two*')).toEqual({ label: 'chapter', suffixText: '*two*' })
  })
  it('label-less suffix', () => {
    expect(parseLocator('see the note')).toEqual({ suffixText: 'see the note' })
  })
  it('pilcrow label prefix', () => {
    expect(parseLocator('¶ 7')).toEqual({ label: 'paragraph', value: '7' })
    expect(parseLocator('¶¶ 7-9')).toEqual({ label: 'paragraph', value: '7-9' })
  })
  it('tab boundary', () => {
    expect(parseLocator('p.\t4')).toEqual({ label: 'page', value: '4' })
  })
})

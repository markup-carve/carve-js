import { describe, it, expect } from 'vitest'
import { slugify, inlineText, resolveHeadingIds } from '../src/heading-ids.js'
import { parse, carveToHtml } from '../src/index.js'
import type { InlineNode } from '../src/ast.js'

describe('slugify', () => {
  it('dashes spaces, preserves case by default', () => {
    expect(slugify('Getting Started')).toBe('Getting-Started')
  })
  it('preserves non-ASCII characters AND case by default', () => {
    expect(slugify('Café & Crème')).toBe('Café-Crème')
    expect(slugify('Über uns')).toBe('Über-uns')
    expect(slugify('Привет мир')).toBe('Привет-мир')
    expect(slugify('日本語の見出し')).toBe('日本語の見出し')
  })
  it('replaces each run of non-alphanumeric ASCII with a single dash', () => {
    expect(slugify("What's New?")).toBe('What-s-New')
    expect(slugify('RFC 2119: Key Words')).toBe('RFC-2119-Key-Words')
    expect(slugify('user_id field')).toBe('user-id-field')
  })
  it('prefixes s- when starting with a digit', () => {
    expect(slugify('2024 Recap')).toBe('s-2024-Recap')
  })
  it('falls back to s when empty', () => {
    expect(slugify('!!!')).toBe('s')
    expect(slugify('')).toBe('s')
    expect(slugify('   ')).toBe('s')
  })
  it('collapses and trims dashes', () => {
    expect(slugify('a -- b')).toBe('a-b')
    expect(slugify('  spaced  ')).toBe('spaced')
  })
  it('lowercases per code point when lowercase is set (opt-in, GitHub-style)', () => {
    expect(slugify('Getting Started', { lowercase: true })).toBe('getting-started')
    expect(slugify('Über uns', { lowercase: true })).toBe('über-uns')
    expect(slugify('Привет мир', { lowercase: true })).toBe('привет-мир')
  })
  it('folds to ASCII keeping case when asciiFold is set (opt-in)', () => {
    expect(slugify('Über uns', { asciiFold: true })).toBe('Uber-uns')
    expect(slugify('Café & Crème', { asciiFold: true })).toBe('Cafe-Creme')
    expect(slugify('Привет мир', { asciiFold: true })).toBe('Privet-mir')
  })
  it('combines asciiFold and lowercase for a fully lowercase ASCII slug', () => {
    expect(slugify('Über uns', { asciiFold: true, lowercase: true })).toBe('uber-uns')
    expect(slugify('Café & Crème', { asciiFold: true, lowercase: true })).toBe(
      'cafe-creme',
    )
  })
})

describe('inlineText', () => {
  it('flattens emphasis, keeps code, ignores images/breaks', () => {
    const nodes: InlineNode[] = [
      { type: 'text', value: 'Why ' },
      { type: 'italic', children: [{ type: 'text', value: 'Carve' }] },
      { type: 'text', value: '?' },
    ]
    expect(inlineText(nodes)).toBe('Why Carve?')
  })
  it('includes inline code text', () => {
    const nodes: InlineNode[] = [
      { type: 'text', value: 'The ' },
      { type: 'code', value: 'id' },
      { type: 'text', value: ' field' },
    ]
    expect(inlineText(nodes)).toBe('The id field')
  })
})

describe('crossref parsing', () => {
  it('parses </#id> into a crossref inline node', () => {
    const doc = parse('See </#intro> now.')
    const para = doc.children[0]
    expect(para.type).toBe('paragraph')
    const kids = (para as { children: InlineNode[] }).children
    expect(kids.map((n) => n.type)).toContain('crossref')
    const cr = kids.find((n) => n.type === 'crossref') as {
      type: 'crossref'
      target: string
    }
    expect(cr.target).toBe('intro')
  })
})

describe('resolveHeadingIds', () => {
  it('assigns an auto id to a plain heading', () => {
    const doc = parse('# Getting Started')
    resolveHeadingIds(doc)
    expect((doc.children[0] as { attrs?: { id?: string } }).attrs?.id).toBe(
      'Getting-Started',
    )
  })
  it('keeps an explicit id verbatim and never suffixes it', () => {
    const doc = parse('{#Keep_This}\n# A\n\n{#Keep_This}\n# A')
    resolveHeadingIds(doc)
    const ids = doc.children
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { attrs?: { id?: string } }).attrs?.id)
    expect(ids).toEqual(['Keep_This', 'Keep_This'])
  })
  it('suffixes duplicate auto ids 1-based in document order', () => {
    const doc = parse('# Setup\n\n# Notes\n\n# Setup\n\n# Setup')
    resolveHeadingIds(doc)
    const ids = doc.children
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { attrs?: { id?: string } }).attrs?.id)
    expect(ids).toEqual(['Setup', 'Notes', 'Setup-2', 'Setup-3'])
  })
  it('deduplicates many colliding heading ids in linear time', () => {
    const source = ['{#dup}', '# seed', ...Array.from({ length: 5000 }, () => '# dup')].join('\n\n')
    const start = performance.now()
    const doc = parse(source)
    resolveHeadingIds(doc)
    const elapsed = performance.now() - start
    const ids = doc.children
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { attrs?: { id?: string } }).attrs?.id)

    expect(elapsed).toBeLessThan(1000)
    expect(ids.slice(0, 4)).toEqual(['dup', 'dup-2', 'dup-3', 'dup-4'])
    expect(ids.at(-1)).toBe('dup-5001')
  })
  it('shares the namespace: auto collides with earlier explicit (case-sensitive)', () => {
    // Dedup is case-sensitive (verbatim `used` set). The explicit `Intro`
    // matches the case-preserved auto slug, so the second heading suffixes.
    const doc = parse('{#Intro}\n# Intro\n\n# Intro')
    resolveHeadingIds(doc)
    const ids = doc.children
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { attrs?: { id?: string } }).attrs?.id)
    expect(ids).toEqual(['Intro', 'Intro-2'])
  })
  it('resolves </#id> case-insensitively to a link with cloned target text', () => {
    // The auto id is case-preserving (`Getting-Started`); a lowercase
    // `</#getting-started>` still resolves (case-insensitive lookup) and
    // emits the target's ACTUAL case-preserved id.
    const html = carveToHtml('# Getting Started\n\nSee </#getting-started>.')
    // The id lives on the <section>, not the <h1> (PART 9 §13).
    expect(html).toContain('<section id="Getting-Started">')
    expect(html).toContain('<h1>Getting Started</h1>')
    expect(html).toContain('<a href="#Getting-Started">Getting Started</a>')
  })
  it('renders an unresolved </#id> as literal text', () => {
    const html = carveToHtml('See </#nope>.')
    expect(html).toContain('&lt;/#nope&gt;')
    expect(html).not.toContain('<a href="#nope"')
  })
  it('ambiguous bare ref resolves to the first occurrence', () => {
    const html = carveToHtml('# Setup\n\n# Setup\n\nGo </#setup>.')
    expect(html).toContain('<a href="#Setup">Setup</a>')
  })
  it('bounds repeated crossrefs to a large target', () => {
    const heading = `# ${'large target '.repeat(1000)}`
    const refs = Array.from({ length: 3000 }, () => '</#target>').join(' ')
    const start = performance.now()
    const doc = parse(`{#target}\n${heading}\n\n${refs}`)
    resolveHeadingIds(doc)
    const elapsed = performance.now() - start
    const para = doc.children[1]

    expect(elapsed).toBeLessThan(1000)
    expect(para.type).toBe('paragraph')
    expect(para.children[0]?.type).toBe('link')
    expect(para.children[0]?.href).toBe('#target')
  })

  it('clones finalized target children for refs that precede the target', () => {
    // A body crossref appears BEFORE its target heading, and that heading
    // itself contains a nested crossref. The clone cache must capture the
    // resolved nested text, for the early ref AND a later one.
    const src = ['See </#a>.', '', '{#a}', '# Title </#b>', '', '{#b}', '# Bee', '', 'Again </#a>.'].join(
      '\n',
    )
    const html = carveToHtml(src)
    expect(html).not.toContain('&lt;/#b&gt;')
    expect(html).not.toContain('</#b>')
    // Both references resolve to the same finalized nested text "Title Bee".
    const matches = html.match(/Title Bee/g) ?? []
    expect(matches.length).toBe(2)
  })
})

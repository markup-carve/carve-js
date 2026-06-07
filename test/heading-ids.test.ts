import { describe, it, expect } from 'vitest'
import { slugify, inlineText, resolveHeadingIds } from '../src/heading-ids.js'
import { parse, carveToHtml } from '../src/index.js'
import type { InlineNode } from '../src/ast.js'

describe('slugify', () => {
  it('dashes spaces, lowercases (GitHub-style)', () => {
    expect(slugify('Getting Started')).toBe('getting-started')
  })
  it('preserves non-ASCII characters by default (only case folded)', () => {
    expect(slugify('Café & Crème')).toBe('café-crème')
    expect(slugify('Über uns')).toBe('über-uns')
    expect(slugify('Привет мир')).toBe('привет-мир')
    expect(slugify('日本語の見出し')).toBe('日本語の見出し')
  })
  it('replaces each run of non-alphanumeric ASCII with a single dash', () => {
    expect(slugify("What's New?")).toBe('what-s-new')
    expect(slugify('RFC 2119: Key Words')).toBe('rfc-2119-key-words')
    expect(slugify('user_id field')).toBe('user-id-field')
  })
  it('prefixes s- when starting with a digit', () => {
    expect(slugify('2024 Recap')).toBe('s-2024-recap')
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
  it('folds to ASCII when asciiFold is set (opt-in)', () => {
    expect(slugify('Über uns', true)).toBe('uber-uns')
    expect(slugify('Café & Crème', true)).toBe('cafe-creme')
    expect(slugify('Привет мир', true)).toBe('privet-mir')
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
      'getting-started',
    )
  })
  it('keeps an explicit id verbatim and never suffixes it', () => {
    const doc = parse('# A {#Keep_This}\n\n# A {#Keep_This}')
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
    expect(ids).toEqual(['setup', 'notes', 'setup-2', 'setup-3'])
  })
  it('shares the namespace: auto collides with earlier explicit', () => {
    const doc = parse('# Intro {#intro}\n\n# Intro')
    resolveHeadingIds(doc)
    const ids = doc.children
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { attrs?: { id?: string } }).attrs?.id)
    expect(ids).toEqual(['intro', 'intro-2'])
  })
  it('resolves </#id> to a link with cloned target text', () => {
    const html = carveToHtml('# Getting Started\n\nSee </#getting-started>.')
    // The id lives on the <section>, not the <h1> (PART 9 §13).
    expect(html).toContain('<section id="getting-started">')
    expect(html).toContain('<h1>Getting Started</h1>')
    expect(html).toContain('<a href="#getting-started">Getting Started</a>')
  })
  it('renders an unresolved </#id> as literal text', () => {
    const html = carveToHtml('See </#nope>.')
    expect(html).toContain('&lt;/#nope&gt;')
    expect(html).not.toContain('<a href="#nope"')
  })
  it('ambiguous bare ref resolves to the first occurrence', () => {
    const html = carveToHtml('# Setup\n\n# Setup\n\nGo </#setup>.')
    expect(html).toContain('<a href="#setup">Setup</a>')
  })
})

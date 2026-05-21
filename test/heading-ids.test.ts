import { describe, it, expect } from 'vitest'
import { slugify, inlineText, resolveHeadingIds } from '../src/heading-ids.js'
import { parse, carveToHtml } from '../src/index.js'
import type { InlineNode } from '../src/ast.js'

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Getting Started')).toBe('getting-started')
  })
  it('transliterates Latin Unicode to ASCII; unmapped scripts pass through', () => {
    // Latin diacritics go through the baked Unicode->ASCII map for
    // share-safety (auto-linkers routinely mangle non-ASCII fragments).
    expect(slugify('Café & Crème')).toBe('cafe-creme')
    expect(slugify('Über uns')).toBe('uber-uns')
    expect(slugify('Привет мир')).toBe('privet-mir')
    // Scripts the deterministic map does not cover (CJK, Arabic, ...)
    // pass through. Authors can attach an explicit `{#id}` for a
    // share-safe slug.
    expect(slugify('日本語の見出し')).toBe('日本語の見出し')
  })
  it('deletes CSS-unsafe punctuation before dashing', () => {
    expect(slugify("What's New?")).toBe('whats-new')
    expect(slugify('RFC 2119: Key Words')).toBe('rfc-2119-key-words')
  })
  it('preserves underscore and hyphen', () => {
    expect(slugify('user_id field')).toBe('user_id-field')
  })
  it('prefixes section- when starting with a digit', () => {
    expect(slugify('2024 Recap')).toBe('section-2024-recap')
  })
  it('falls back to section when empty', () => {
    expect(slugify('!!!')).toBe('section')
    expect(slugify('')).toBe('section')
    expect(slugify('   ')).toBe('section')
  })
  it('collapses and trims dashes', () => {
    expect(slugify('a -- b')).toBe('a-b')
    expect(slugify('  spaced  ')).toBe('spaced')
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

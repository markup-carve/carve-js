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

  it('clones target text one level for refs that precede the target', () => {
    // A body crossref appears BEFORE its target heading, and that heading
    // itself contains a nested crossref (`# Title </#b>`). Crossref resolution
    // is strictly ONE LEVEL (matching carve-php / carve-rs): `</#a>` shows
    // `Title ` -- the target's own text, with the nested `</#b>` flattened
    // away, NOT expanded into `Title Bee`. The target heading still renders its
    // own `</#b>` as a one-level link. The clone cache shares this resolved
    // one-level text across the early ref AND the later one.
    const src = ['See </#a>.', '', '{#a}', '# Title </#b>', '', '{#b}', '# Bee', '', 'Again </#a>.'].join(
      '\n',
    )
    const html = carveToHtml(src)
    expect(html).not.toContain('&lt;/#b&gt;')
    expect(html).not.toContain('</#b>')
    // Both references resolve to the same one-level text `Title `.
    expect((html.match(/<a href="#a">Title <\/a>/g) ?? []).length).toBe(2)
    expect(html).not.toContain('Title Bee')
    // The target heading itself still renders its own crossref one level deep.
    expect(html).toContain('<h1>Title <a href="#b">Bee</a></h1>')
  })

  // A crossref CYCLE used to overflow the call stack (`RangeError: Maximum
  // call stack size exceeded`) in `enforceNoNesting`, crashing every public
  // API on tiny untrusted input. Cycles must now resolve to a one-level link
  // (the target's bare text), matching carve-php / carve-rs.
  describe('crossref cycles (no stack overflow)', () => {
    it('resolves a self-referencing crossref to a one-level link', () => {
      // `# A </#a>`: the heading title cross-references its OWN id.
      const html = carveToHtml('# A </#a>')
      expect(html).toBe(
        ['<section id="A">', '  <h1>A <a href="#A">A </a></h1>', '</section>'].join('\n'),
      )
    })

    it('resolves a mutual A<->B crossref cycle without recursion', () => {
      const html = carveToHtml('# A </#b>\n\n# B </#a>')
      expect(html).toBe(
        [
          '<section id="A">',
          '  <h1>A <a href="#B">B </a></h1>',
          '</section>',
          '<section id="B">',
          '  <h1>B <a href="#A">A </a></h1>',
          '</section>',
        ].join('\n'),
      )
    })

    it('breaks a heading + paragraph self-reference cycle', () => {
      const html = carveToHtml('# T </#t>\n\nsee </#t>')
      expect(html).toBe(
        [
          '<section id="T">',
          '  <h1>T <a href="#T">T </a></h1>',
          '  <p>see <a href="#T">T </a></p>',
          '</section>',
        ].join('\n'),
      )
    })

    it('does not throw on a longer (3-node) crossref cycle', () => {
      const src = '# A </#b>\n\n# B </#c>\n\n# C </#a>'
      expect(() => carveToHtml(src)).not.toThrow()
      const html = carveToHtml(src)
      // Each link href points at the next node; the back-edge to a node already
      // on the resolution stack is dropped (no infinite expansion).
      expect(html).toContain('<a href="#B">')
      expect(html).toContain('<a href="#C">')
      expect(html).toContain('<a href="#A">')
      expect(html).not.toContain('</#')
    })

    it('does not throw or blow up on a large (5000-node) crossref ring', () => {
      // Resolution is one-level and non-recursive in the crossref graph, so a
      // long ring is bounded -- no O(n) recursion depth (stack overflow) and no
      // O(n^2) expansion around the ring.
      const parts: string[] = []
      const n = 5000
      for (let i = 0; i < n; i++) parts.push(`# H${i} </#h${(i + 1) % n}>`)
      expect(() => carveToHtml(parts.join('\n\n'))).not.toThrow()
    })

    it('resolves a NON-cyclic crossref chain to one-level links', () => {
      // A->B->C is a one-way chain. Crossref resolution is strictly one level
      // (matching carve-php / carve-rs): A's link to B shows B's own text, and
      // B's own `</#c>` is NOT recursively expanded into A's link text.
      const html = carveToHtml('# A </#b>\n\n# B </#c>\n\n# C')
      expect(html).toContain('<h1>A <a href="#B">B </a></h1>')
      expect(html).toContain('<h1>B <a href="#C">C</a></h1>')
      expect(html).toContain('<h1>C</h1>')
    })
  })
})

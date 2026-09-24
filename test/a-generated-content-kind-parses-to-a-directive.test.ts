/*
 * CARVE-P12-057: `:::` produces one of three types. Anonymous or attribute-only
 * is a `div`, a kind naming generated content is a `directive`, and every other
 * named container is an `admonition`.
 *
 * The `div` group is the CONTROL: it passes on both sides of the split, which
 * is what shows the dispatch only moved the six kinds.
 */

import { describe, it, expect } from 'vitest'
import { parse, carveToHtml, renderCarve, toAstJson, fromAstJson, GENERATED_CONTENT_KINDS } from '../src/index.js'

const typeOf = (src: string): string => parse(src).children[0]!.type
const firstBlock = (src: string): Record<string, unknown> =>
  parse(src).children[0] as unknown as Record<string, unknown>

describe('a generated-content kind parses to a directive', () => {
  const kinds = ['bibliography', 'footnotes', 'glossary', 'index', 'references', 'toc']

  it.each(kinds)('::: %s is a directive carrying that kind', (kind) => {
    const node = firstBlock(`::: ${kind}\n:::\n`)

    expect(node.type).toBe('directive')
    expect(node.kind).toBe(kind)
  })

  it('names the same six kinds the schema enumerates', () => {
    expect([...GENERATED_CONTENT_KINDS].sort()).toEqual(kinds)
  })

  it('keeps the blocks written inside the opener', () => {
    const node = firstBlock('::: toc\nauthored\n:::\n')

    expect((node.children as { type: string }[]).map((c) => c.type)).toEqual(['paragraph'])
  })

  it('carries an opener [label], which core does not render', () => {
    expect(firstBlock('::: toc [Main]\n:::\n').label).toBe('Main')
  })

  it('survives the AST-JSON round trip as a directive', () => {
    const doc = parse('::: toc\nbody\n:::\n')
    const back = fromAstJson(JSON.parse(JSON.stringify(toAstJson(doc))))

    expect(back.children.map((c) => c.type)).toEqual(['directive'])
  })

  it('publishes no title, which the schema does not name on this node', () => {
    // markup-carve/carve#2247: the opener grammar admits a quoted title on
    // every named container and `directive` has no slot for one.
    expect(firstBlock('::: toc "Contents"\n:::\n')).not.toHaveProperty('title')
  })
})

describe('every other named container is still an admonition', () => {
  it.each(['note', 'tip', 'warning', 'danger', 'info', 'success', 'example', 'quote'])(
    'the Tier-1 kind %s is an admonition',
    (kind) => {
      expect(typeOf(`::: ${kind}\n:::\n`)).toBe('admonition')
    },
  )

  it.each(['sidebar', 'details', 'list-table', 'tabs'])(
    'the Tier-2 kind %s is an admonition',
    (kind) => {
      expect(typeOf(`::: ${kind}\n:::\n`)).toBe('admonition')
    },
  )

  it.each(['endnotes', 'contents', 'bibliographies', 'toc-2'])(
    'the generated-LOOKING kind %s is an admonition, because the list is closed',
    (kind) => {
      // The clause names six kinds and rules that every other named container
      // is an admonition, so a seventh word that reads like generated content
      // is not one.
      expect(typeOf(`::: ${kind}\n:::\n`)).toBe('admonition')
    },
  )

  it('keeps the title the six kinds cannot carry', () => {
    expect(firstBlock('::: sidebar "Aside"\n:::\n').title).toBeDefined()
  })
})

describe('the control: an unnamed container is still a div', () => {
  it('a bare ::: opens a div', () => {
    expect(typeOf(':::\nbody\n:::\n')).toBe('div')
  })

  it('an attribute-only container opens a div', () => {
    expect(typeOf('{.toc}\n:::\nbody\n:::\n')).toBe('div')
  })

  it('a div carrying the class a directive renders is still a div', () => {
    // The attribute spelling and the kind spelling are different documents:
    // only the opener WORD dispatches.
    const node = firstBlock('{.toc #x}\n:::\nbody\n:::\n')

    expect(node.type).toBe('div')
    expect(node).not.toHaveProperty('kind')
  })
})

describe('what the split does not move', () => {
  it('renders a directive exactly as the generic container it replaced', () => {
    expect(carveToHtml('::: toc\nbody\n:::\n')).toBe('<div class="toc">\n  <p>body</p>\n</div>')
  })

  it('writes the same source back', () => {
    expect(renderCarve(parse('::: toc\nbody\n:::\n'))).toBe('::: toc\nbody\n:::\n')
  })

  it('still places the endnotes section at a ::: footnotes marker', () => {
    const html = carveToHtml('a[^1]\n\n::: footnotes\n:::\n\nafter\n\n[^1]: n\n')

    expect(html.indexOf('doc-endnotes')).toBeLessThan(html.indexOf('after'))
  })
})

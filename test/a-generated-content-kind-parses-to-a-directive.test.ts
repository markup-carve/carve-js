/*
 * CARVE-P12-057: `:::` produces one of three types. Anonymous or attribute-only
 * is a `div`, a kind naming generated content is a `directive`, and every other
 * named container is an `admonition`.
 *
 * The `div` group is the CONTROL: it passes on both sides of the split, which
 * is what shows the dispatch only moved the six kinds.
 */

import { describe, expectTypeOf, it, expect } from 'vitest'
import {
  parse,
  carveToHtml,
  carveToMarkdown,
  inspectColonFences,
  lintCarve,
  renderCarve,
  toAstJson,
  fromAstJson,
  GENERATED_CONTENT_KINDS,
  type Directive,
  type IncludeDirective,
} from '../src/index.js'

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

describe('every pass that walked a container still walks a directive', () => {
  // A prepass that stops at the new type does not fail loudly: it drops the
  // heading anchor the reference beside it still needed, and the reference
  // degrades to plain text. The div case is the control.
  const anchored = (fence: string) =>
    carveToMarkdown(`${fence}\n## Inner\n:::\n\nSee [x](#Inner).\n`)

  it('keeps the anchor a reference into a directive needs', () => {
    expect(anchored('::: toc')).toContain('## Inner {#Inner}')
    expect(anchored('::: toc')).toContain('[x](#Inner)')
  })

  it('keeps it for a div too, as it always did', () => {
    expect(anchored(':::')).toContain('## Inner {#Inner}')
  })

  it('numbers a footnote referenced from inside a directive', () => {
    const html = carveToHtml('::: toc\nsee[^a]\n:::\n\n[^a]: note\n')

    expect(html).toContain('doc-noteref')
    expect(html).toContain('note')
  })
})

describe('the diagnostics name what they found', () => {
  const unclosed = (fence: string) =>
    lintCarve(`${fence}\nbody\n`).find((w) => w.rule === 'unclosed-container-fence')?.message

  it('calls an unclosed directive fence a directive', () => {
    expect(unclosed('::: toc')).toContain('3-colon directive')
  })

  it('still calls an unclosed named fence an admonition', () => {
    expect(unclosed('::: note')).toContain('3-colon admonition')
  })

  it('still calls an unclosed bare fence a div', () => {
    expect(unclosed(':::')).toContain('3-colon div')
  })

  it('reports the fence it inspected under its own kind', () => {
    const [pair] = inspectColonFences('::: toc\nbody\n:::\n').pairs

    expect(pair?.opener.kind).toBe('directive')
  })
})

describe('the node type is reachable by name from the package root', () => {
  it('types a parsed directive as Directive', () => {
    // The include module exports a different `Directive` (a parsed
    // `{{include}}` token), and an explicit re-export of that one shadowed the
    // star export from `ast.ts`, so the AST type had no reachable name. That one
    // is `IncludeDirective` now.
    const node = parse('::: toc\n:::\n').children[0]
    const typed: Directive | undefined = node?.type === 'directive' ? node : undefined

    expect(typed?.kind).toBe('toc')
    expectTypeOf<IncludeDirective>().toHaveProperty('path')
  })
})

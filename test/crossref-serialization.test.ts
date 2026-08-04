import { describe, it, expect } from 'vitest'
import {
  carveToAstJson,
  carveToCarve,
  carveToHtml,
  carveToMarkdown,
  fromAstJson,
  parse,
  renderCarve,
  resolve,
} from '../src/index.js'
import type { CrossRef, Paragraph } from '../src/ast.js'

/*
 * PART 12 §3a, as carve#614 applies it to `</#id>`: the authored construct
 * survives into the tree and the resolution is published beside it.
 *
 * This engine used to replace a resolved crossref with a `link` and flatten an
 * unresolved one to text. Both are shapes §3a rules out, and the first one
 * loses information no other field carries: ids resolve case-insensitively, so
 * `</#intro>` and `</#Intro>` both produce `href: "#Intro"` and only `target`
 * says which the author wrote. carve-js#605.
 */
describe('a crossref serializes as a heading_ref', () => {
  const inlines = (source: string) => {
    const json = carveToAstJson(source) as unknown as {
      children: Array<{ type: string; children?: Array<Record<string, unknown>> }>
    }
    const para = json.children.findLast((n) => n.type === 'paragraph')
    return para?.children ?? []
  }

  it('publishes the authored target and the resolved destination', () => {
    const [, ref] = inlines('# Intro\n\nSee </#intro>.\n')
    expect(ref).toMatchObject({ type: 'heading_ref', target: 'intro', href: '#Intro' })
  })

  it('keeps the spelling the author used, not the id it resolved to', () => {
    const [, lower] = inlines('# Intro\n\nSee </#intro>.\n')
    const [, upper] = inlines('# Intro\n\nSee </#Intro>.\n')
    expect(lower).toMatchObject({ target: 'intro', href: '#Intro' })
    expect(upper).toMatchObject({ target: 'Intro', href: '#Intro' })
  })

  it('publishes an unresolved crossref as a node, not as text', () => {
    // Flattening discards the fact that the author wrote a reference at all,
    // and gives the same document two node counts depending on the engine.
    const kids = inlines('See </#Nope>.\n')
    expect(kids.map((n) => n['type'])).toEqual(['text', 'heading_ref', 'text'])
    expect(kids[1]).toMatchObject({ type: 'heading_ref', target: 'Nope' })
    expect(kids[1]!['href']).toBeUndefined()
  })

  it('keeps the display text off the wire', () => {
    // §3a: the heading is in the same document, so a consumer reads the text
    // from there rather than from a copy in every reference.
    const [, ref] = inlines('# Intro\n\nSee </#intro>.\n')
    expect(ref!['resolvedText']).toBeUndefined()
    expect(ref!['children']).toBeUndefined()
  })

  it('survives a wire round trip with its authored spelling', () => {
    // The reason the field exists. Decoding and writing back used to produce
    // `</#Intro>` for either spelling, because the published tree had only the
    // resolved href.
    const source = '# Intro\n\nSee </#intro>.\n'
    const decoded = fromAstJson(JSON.parse(JSON.stringify(carveToAstJson(source))))
    // The crossref specifically: the decoded document also materializes the
    // heading's generated id as an authored `{#Intro}` line, which is a
    // separate question about ids and not this one.
    expect(renderCarve(decoded)).toContain('See </#intro>.')
  })

  it('renders exactly as it did before the tree changed', () => {
    const source = '# Intro\n\nSee </#intro> and </#Nope>.\n'
    expect(carveToHtml(source)).toContain(
      '<p>See <a href="#Intro">Intro</a> and &lt;/#Nope&gt;.</p>',
    )
    expect(carveToMarkdown(source).trim()).toBe(
      '# Intro {#Intro}\n\nSee [Intro](#Intro) and </#Nope>.',
    )
  })

  it('does not nest an anchor inside a link, and keeps the node anyway', () => {
    // "Links never nest" is a rendering rule; §3a is a tree rule. Both hold:
    // the anchor is suppressed, the crossref is still in the tree.
    const source = '# H\n\n[see </#H>](/outer)\n'
    expect(carveToHtml(source)).toContain('<p><a href="/outer">see H</a></p>')

    const doc = resolve(parse(source))
    const para = doc.children.findLast((n) => n.type === 'paragraph') as Paragraph
    const link = para.children[0] as { children: Array<{ type: string }> }
    expect(link.children.map((c) => c.type)).toEqual(['text', 'heading_ref'])
    expect((link.children[1] as CrossRef).href).toBe('#H')
  })
})

import { describe, expect, it } from 'vitest'
import {
  fromAstJson, parse, renderHtml, renderMarkdown, renderPlainText, resolve, toAstJson,
} from '../src/index.js'

// carve-js#2238. PART 12 §3a keeps a cross-reference's display text OFF the wire
// - the target is in the same document, so copying its inlines into every
// reference is unbounded where `href` is fixed-size. The reader has to derive
// it, and this one did not, so every cross-reference came back as an empty
// anchor. The assertions below are on the TEXT: a check on the shape passes
// while the words are gone, which is how this survived a structural round-trip
// gate.
const roundTrip = (src: string) => {
  const direct = resolve(parse(src, { positions: true }))
  const wire = JSON.parse(JSON.stringify(toAstJson(direct))) as unknown
  return { direct, ingested: fromAstJson(wire), wire: JSON.stringify(wire) }
}

describe('an ingested cross-reference keeps its text', () => {
  it('derives a bare crossref label from the heading in the same document', () => {
    const { direct, ingested } = roundTrip('# H\n\nsee </#H>\n')
    expect(renderHtml(ingested)).toContain('<a href="#H">H</a>')
    expect(renderHtml(ingested)).toBe(renderHtml(direct))
  })

  it('keeps the label when the crossref sits inside a link label', () => {
    const { direct, ingested } = roundTrip('# H\n\n[see </#H>](/outer)\n')
    expect(renderHtml(ingested)).toContain('<a href="/outer">see H</a>')
    expect(renderHtml(ingested)).toBe(renderHtml(direct))
  })

  it('keeps the label on every target, not only HTML', () => {
    const { ingested } = roundTrip('# H\n\n[see </#H>](/outer)\n')
    expect(renderMarkdown(ingested)).toContain('[see H](/outer)')
    expect(renderPlainText(ingested)).toContain('see H')
  })

  it('does not put the derived text on the wire, which is why it is derived', () => {
    expect(roundTrip('# H\n\nsee </#H>\n').wire).not.toContain('resolvedText')
  })

  it('rebuilds a numbered caption label from the number the payload published', () => {
    const src = '{#fig-sun}\n![A sunset](sun.jpg)\n^ Figure #: A sunset\n\nSee </#fig-sun>.\n'
    const { direct, ingested } = roundTrip(src)
    expect(renderHtml(ingested)).toContain('<a href="#fig-sun">Figure 1</a>')
    expect(renderHtml(ingested)).toBe(renderHtml(direct))
  })

  it('rebuilds a composite panel label, letter and all', () => {
    const src = '{#fig-x}\n::: figure\n{#fig-x-a}\n![one](a.png)\n^ (a) One\n:::\n^ Figure #: Second\n\nSee </#fig-x-a>.\n'
    const { direct, ingested } = roundTrip(src)
    expect(renderHtml(ingested)).toContain('<a href="#fig-x-a">Figure 1a</a>')
    expect(renderHtml(ingested)).toBe(renderHtml(direct))
  })

  // The other half of §3a: a reference whose target is not in the payload stays
  // unresolved and renders its own source. Deriving ids here would invent a
  // target the sender never had.
  it('leaves a crossref unresolved when the payload published no id for it', () => {
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [
        { type: 'heading', level: 1, children: [{ type: 'text', value: 'Title Here' }] },
        { type: 'paragraph', children: [{ type: 'heading_ref', target: 'title-here' }] },
      ],
    } as never)
    expect(renderHtml(doc)).toContain('&lt;/#title-here&gt;')
    expect(renderHtml(doc)).not.toContain('<h1 id=')
  })
})

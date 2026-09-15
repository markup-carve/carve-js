import { describe, expect, it } from 'vitest'
import {
  carveToAnsi,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  citations,
  expandIncludes,
  headingLevelShift,
  parse,
  Profile,
  renderDocument,
  renderHtml,
  resolve,
  type CarveExtension,
} from '../src/index.js'

// A FRESH instance per call. `citations()` closes over per-document state that
// `afterParse` resets, so one instance shared between the two sides of an
// equality would let the entry point's run seed the seam's - and a seam that
// never ran `afterParse` would still look right.
const exts = (): CarveExtension[] => [citations()]

// `citations` changes the PARSE (`matchInline` claims `[@key]`), then carries
// an `afterParse` that collects the bibliography, a `beforeRender` that numbers
// the groups and appends the references carrier, and renderers for both. It is
// the extension named in carve-js#1677 as the reason a hand-composed pipeline
// degrades instead of failing.
const CITED = `# Sorting

Claimed by [@knuth], and again by [@knuth]; see also [@dijkstra].

[@knuth]: Knuth, D. The Art of Computer Programming.
[@dijkstra]: Dijkstra, E. Go To Statement Considered Harmful.
`

describe('a document the host already holds renders through the host pipeline', () => {
  it('matches the string entry point through a parse-changing extension', () => {
    const held = parse(CITED, { extensions: exts(), positions: true })
    expect(renderDocument(held, { extensions: exts() })).toBe(
      carveToHtml(CITED, { extensions: exts() }),
    )
  })

  it('renders what the reachable-today composition drops', () => {
    // Pins the DEGRADATION rather than only the parity, so the equality above
    // cannot pass by both sides being equally empty.
    const html = renderDocument(parse(CITED, { extensions: exts(), positions: true }), {
      extensions: exts(),
    })
    expect(html).toContain('<ol class="references">')
    expect(html).toContain('data-cite-key="knuth"')
    expect(html).not.toContain('[@knuth]')
  })

  it('leaves the hand-composed pipeline visibly short of it', () => {
    // The composition a host can reach without this seam: `applyTransforms` is
    // private, so `renderHtml(resolve(doc))` is as far as it gets.
    const naive = renderHtml(resolve(parse(CITED, { extensions: exts(), positions: true })), {
      extensions: exts(),
    })
    expect(naive).toContain('[@knuth]')
    expect(naive).not.toContain('<ol class="references">')
  })

  // `citations` renders through HTML-only hooks, so its transforms leave the
  // Markdown, plain and ANSI bytes alone - an equality on those targets would
  // hold with no transform running at all. `headingLevelShift` is the one that
  // bites there: a `beforeRender` that rewrites heading levels in the tree,
  // which every renderer then reads.
  const SHIFTED = '# Top\n\n## Under\n\nBody text.\n'
  const shift = (): CarveExtension[] => [headingLevelShift({ shift: 2 })]

  // `'plain'` is the weak row of the three and stays green under a mutation
  // that drops the transforms: the plain renderer writes a heading as bare
  // text with no level marker, so `Top\n\nUnder\n\nBody text.\n` comes out
  // byte-identical shifted or not. It pins seam-to-entry-point parity for that
  // target and nothing about the transform; Markdown and ANSI carry the level.
  for (const target of ['markdown', 'plain', 'ansi'] as const) {
    it(`matches the ${target} entry point through a transform that reaches it`, () => {
      const held = parse(SHIFTED, { extensions: shift(), positions: true })
      const viaEntry = target === 'markdown'
        ? carveToMarkdown(SHIFTED, { extensions: shift() })
        : target === 'plain'
          ? carveToPlainText(SHIFTED, { extensions: shift() })
          : carveToAnsi(SHIFTED, { extensions: shift() })
      expect(renderDocument(held, { extensions: shift(), target })).toBe(viaEntry)
    })
  }

  it('shifts the heading levels on the Markdown target, not just matches', () => {
    // Pins that the equalities above are not both sides skipping the transform.
    const md = renderDocument(parse(SHIFTED, { extensions: shift(), positions: true }), {
      extensions: shift(),
      target: 'markdown',
    })
    expect(md.startsWith('### Top\n')).toBe(true)
    expect(md).toContain('#### Under')
  })

  it('applies the profile the entry point applies', () => {
    const src = '# H\n\nA [link](https://example.com/x) and `code`.\n'
    const held = parse(src, { positions: true })
    const viaSeam = renderDocument(held, { profile: Profile.comment() })
    expect(viaSeam).toBe(carveToHtml(src, { profile: Profile.comment() }))
    // Pins that the profile actually bit, so the equality cannot pass by both
    // sides skipping it: `comment` strips the heading and marks the link.
    expect(viaSeam).toContain('rel="nofollow ugc"')
    expect(viaSeam).not.toContain('<h1>')
  })

  it('resolves heading ids and footnote numbers, with no extension in play', () => {
    const src = '# A Heading\n\nText[^n] and [A Heading][].\n\n[^n]: Note.\n'
    const held = parse(src, { positions: true })
    expect(renderDocument(held, {})).toBe(carveToHtml(src, {}))
  })
})

describe('an include-expanded document renders through the host pipeline', () => {
  const PARENT = `# Parent

Parent cites [@knuth] and [@knuth].

{{ child.crv }}

[@knuth]: Knuth, D. The Art of Computer Programming.
`
  const CHILD = `## Child

A paragraph the child contributes.
`
  // The same document written as one file. This is the equivalence the seam
  // owes a host: expanding then rendering must land where rendering the merged
  // source lands.
  const MERGED = `# Parent

Parent cites [@knuth] and [@knuth].

## Child

A paragraph the child contributes.

[@knuth]: Knuth, D. The Art of Computer Programming.
`

  const expand = () => {
    const doc = parse(PARENT, { extensions: exts(), positions: true })
    return expandIncludes(doc, PARENT, {
      resolve: (path) => (path === 'child.crv' ? { id: 'child.crv', source: CHILD } : null),
    })
  }

  it('matches the string entry point on the equivalent single document', () => {
    const expanded = expand()
    expect(expanded.warnings).toEqual([])
    expect(renderDocument(expanded.doc, { extensions: exts() })).toBe(
      carveToHtml(MERGED, { extensions: exts() }),
    )
  })

  it('numbers the citations and emits the references list over the merged tree', () => {
    const html = renderDocument(expand().doc, { extensions: exts() })
    expect(html).toContain('<ol class="references">')
    expect(html).toContain('<h2>Child</h2>')
  })
})

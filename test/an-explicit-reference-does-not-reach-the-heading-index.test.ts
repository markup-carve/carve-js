import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

/**
 * PART 9R R1, THE EXPLICIT FORM DOES NOT REACH THE INDEX -- NORMATIVE
 * (markup-carve/carve#742).
 *
 * The heading-index fallback is scoped to the COLLAPSED `[text][]` and to
 * nothing else. An explicit `[text][label]` whose label matches no linkDefs
 * entry is unresolved and renders as literal source text; it does not fall
 * through to the heading index at ANY spelling, folded or exact.
 *
 * The gate is on the SPELLING, not on "unresolved". A fix keyed on the latter
 * breaks the row that an explicit label naming a real linkDefs entry still
 * resolves, which is why that row is a CONTROL here rather than an afterthought.
 */

/** The href a document's first link resolves to, or null. */
const href = (src: string): string | null => /<a href="([^"]*)"/.exec(carveToHtml(src))?.[1] ?? null

describe('an explicit reference does not reach the heading index', () => {
  it('renders the literal source on the EXACT spelling', () => {
    expect(carveToHtml('# Getting Started\n\n[text][Getting Started]\n')).toBe(
      '<section id="Getting-Started">\n  <h1>Getting Started</h1>\n  <p>[text][Getting Started]</p>\n</section>',
    )
  })

  it('renders the literal source on the FOLDED spelling', () => {
    // The looser matching is what the collapsed form gets. Naming the clause
    // "at ANY spelling, folded or exact" is aimed at exactly this row: a fix
    // that only removed the exact lookup would leave the fold resolving.
    expect(href('# Getting Started\n\n[text][getting started]\n')).toBe(null)
    expect(carveToHtml('# Getting Started\n\n[text][getting started]\n')).toContain(
      '<p>[text][getting started]</p>',
    )
  })

  it('does not reach the index through the RENDERED PLAIN TEXT key either', () => {
    // R1's second key strips the label's markup. Removing only the as-written
    // lookup leaves this one, and `# *bold* heading` is reachable again.
    expect(href('# *bold* heading\n\n[see][*bold* heading]\n')).toBe(null)
  })

  it('is not fooled by an explicit label that equals its own text', () => {
    // `[a][a]` and `[a][]` both carry `ref: "a"`, so a gate reading `ref`
    // alone cannot tell them apart. This row fails on such a gate.
    expect(href('# a\n\n[a][a]\n')).toBe(null)
    expect(href('# a\n\n[a][]\n')).toBe('#a')
  })

  it('CONTROL the collapsed form still reaches the index', () => {
    expect(href('# Getting Started\n\n[getting started][]\n')).toBe('#Getting-Started')
    expect(href('# *bold* heading\n\n[*bold* heading][]\n')).toBe('#bold-heading')
  })

  it('CONTROL an explicit label matching a real linkDefs entry still resolves', () => {
    // The row a fix keyed on "unresolved" rather than on "collapsed" breaks.
    expect(href('[l]: /x\n\n[text][l]\n')).toBe('/x')
    // Including one that ALSO names a heading: linkDefs wins, as it always did.
    expect(href('[Getting Started]: /x\n\n# Getting Started\n\n[text][Getting Started]\n')).toBe(
      '/x',
    )
  })

  it('CONTROL an explicit label naming nothing at all is unchanged', () => {
    expect(carveToHtml('[text][nope]\n')).toBe('<p>[text][nope]</p>')
  })

  it('lint agrees with the resolver', () => {
    // The mirror in `lint.ts` has to move with the resolver or it lies about
    // it: before this clause it stayed silent on a reference that now renders
    // as literal text, which is precisely what the rule reports.
    expect(lintCarve('# Getting Started\n\n[text][Getting Started]\n').map((w) => w.rule)).toEqual([
      'unresolved-reference-link',
    ])
    // CONTROL: the collapsed form still resolves, so lint still says nothing.
    expect(lintCarve('# Getting Started\n\n[getting started][]\n')).toEqual([])
  })
})

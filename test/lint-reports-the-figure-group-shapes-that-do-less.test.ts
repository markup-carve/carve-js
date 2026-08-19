/*
 * PART 9 §4c lint: the shapes that parse fine and silently do less than they
 * look like they do. `figure-group-nested` (a demoted inner `::: figure`),
 * `figure-group-opener-metadata` (title/label keeps the opener a generic
 * container), `figure-group-panel-number` (a `#` in a panel caption stays
 * literal), plus the advisory `figure-group-empty` / `figure-group-single-panel`.
 * A NUMBERED group also registers its id and its panels' ids as valid
 * crossref targets, so those references are not reported broken.
 */
import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/index.js'

const rules = (src: string) => lintCarve(src).map((w) => w.rule)

describe('lint reports the figure group shapes that do less', () => {
  it('flags a nested bare figure fence as demoted', () => {
    const src = '::: figure\n:::: figure\n![a](x.png)\n^ (a) c\n::::\n:::\n^ Figure #: G\n'
    expect(rules(src)).toContain('figure-group-nested')
  })

  it('flags an opener carrying a title or label', () => {
    expect(rules('::: figure "T"\n![a](x.png)\n^ c\n:::\n')).toContain(
      'figure-group-opener-metadata',
    )
    expect(rules('::: figure [g]\nBody.\n:::\n')).toContain('figure-group-opener-metadata')
  })

  it('does not flag other admonition kinds', () => {
    expect(rules('::: note\nBody.\n:::\n')).toEqual([])
  })

  it('flags a # placeholder in a panel caption as literal', () => {
    const src = '::: figure\n![a](x.png)\n^ Figure #: not a unit\n\n![b](y.png)\n^ (b) fine\n:::\n^ Figure #: G\n'
    const found = lintCarve(src).filter((w) => w.rule === 'figure-group-panel-number')
    expect(found).toHaveLength(1)
  })

  it('advises on empty and single-panel groups', () => {
    expect(rules('::: figure\nOnly prose.\n:::\n')).toContain('figure-group-empty')
    expect(rules('::: figure\n![a](x.png)\n^ (a) c\n:::\n')).toContain(
      'figure-group-single-panel',
    )
    const two = '::: figure\n![a](x.png)\n^ a\n\n![b](y.png)\n^ b\n:::\n'
    expect(rules(two)).not.toContain('figure-group-empty')
    expect(rules(two)).not.toContain('figure-group-single-panel')
  })

  it('accepts crossrefs to a numbered group and its panels', () => {
    const src =
      '{#g}\n::: figure\n{#p-a}\n![a](x.png)\n^ a\n\n{#p-b}\n![b](y.png)\n^ b\n:::\n^ Figure #: G\n\nSee </#g>, </#p-a> and </#p-b>.\n'
    expect(rules(src)).not.toContain('broken-crossref')
  })

  it('reports a crossref to a panel of an UNNUMBERED group as broken', () => {
    const src = '::: figure\n{#p}\n![a](x.png)\n^ a\n:::\n\nSee </#p>.\n'
    expect(rules(src)).toContain('broken-crossref')
  })

  it('a heading inside a group is a valid crossref target, not a broken one', () => {
    // The heading index has to descend into the group like the resolver does,
    // or every reference to a heading inside one is a false positive.
    const src =
      'See </#inner-heading>.\n\n::: figure\n## Inner heading\n\n![x](x.png)\n^ (a) x\n:::\n^ Figure #: G\n'
    expect(rules(src)).not.toContain('broken-crossref')
  })

  it('a duplicate heading id inside a group is still detected', () => {
    const src = '# Same\n\n::: figure\n## Same\n\n![x](x.png)\n^ (a) x\n:::\n'
    expect(rules(src)).toContain('duplicate-heading-id')
  })
})

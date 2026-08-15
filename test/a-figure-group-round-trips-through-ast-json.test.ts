/*
 * PART 12: `figure_group` on the wire is `{type, children, caption?, attrs?,
 * pos?}` - children as ordinary block nodes in source order, no `panels`
 * array (a consumer derives the panel list by type, the way the renderer
 * does). On ingest, published caption numbers are RE-DERIVED (carve#758), and
 * the group rule lives in the same shared pass, so both paths agree.
 */
import { describe, it, expect } from 'vitest'
import { carveToAstJson, fromAstJson, renderHtml, carveToHtml } from '../src/index.js'

const F2 =
  '{#fig-first}\n![lead](lead.png)\n^ Figure #: First\n\n{#fig-x}\n::: figure\n{#fig-x-a}\n![one](a.png)\n^ (a) One\n:::\n^ Figure #: Second\n'

describe('a figure group round-trips through AST JSON', () => {
  it('publishes children in order and the caption, with no panels array', () => {
    const json = carveToAstJson(F2)
    const group = json.children.find((c) => c.type === 'figure_group') as {
      children: Array<{ type: string }>
      caption?: unknown[]
      panels?: unknown
    }
    expect(group).toBeDefined()
    expect(group.children.map((c) => c.type)).toEqual(['figure'])
    expect(group.caption).toBeDefined()
    expect(group.panels).toBeUndefined()
  })

  it('keeps a panel placeholder as a typed caption_number without n', () => {
    // §4c: the panel is not a sequence unit, so its `#` draws no number - but
    // the node stays TYPED on the wire, un-numbered, exactly as carve-php and
    // carve-rs publish it (the unresolved-reference precedent: keep the node,
    // render its spelling). Flattening it to text would erase what the author
    // wrote from every consumer.
    const json = carveToAstJson(
      '::: figure\n![one](a.png)\n^ Figure #: panel tries a number\n:::\n^ Figure #: Group\n',
    )
    const group = json.children[0] as {
      children: Array<{ caption: Array<{ type: string; n?: number }> }>
      caption: Array<{ type: string; n?: number }>
    }
    const panelNumber = group.children[0]!.caption.find((c) => c.type === 'caption_number')
    expect(panelNumber).toBeDefined()
    expect(panelNumber!.n).toBeUndefined()
    const groupNumber = group.caption.find((c) => c.type === 'caption_number')
    expect(groupNumber?.n).toBe(1)
  })

  it('a captionless group publishes no caption key', () => {
    const json = carveToAstJson('::: figure\n![a](x.png)\n^ (a) c\n:::\n')
    const group = json.children[0] as { type: string; caption?: unknown }
    expect(group.type).toBe('figure_group')
    expect(group.caption).toBeUndefined()
  })

  it('renders the same HTML from the wire as from the source', () => {
    const payload = JSON.parse(JSON.stringify(carveToAstJson(F2)))
    expect(renderHtml(fromAstJson(payload))).toBe(carveToHtml(F2))
  })

  it('re-derives the group number on ingest when the tree published numbers', () => {
    // Delete the leading figure from a PUBLISHED (numbered) tree: the group
    // was "Figure 2" in that document, and must come back "Figure 1" in this
    // one - the §5 re-derivation, with the group as one sequence unit.
    const payload = JSON.parse(JSON.stringify(carveToAstJson(F2))) as {
      children: Array<{ type: string }>
    }
    payload.children = payload.children.filter((c) => c.type !== 'figure')
    const html = renderHtml(fromAstJson(payload))
    expect(html).toContain('<figcaption>Figure 1: Second</figcaption>')
    expect(html).not.toContain('Figure 2')
  })
})

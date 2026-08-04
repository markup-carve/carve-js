import { describe, it, expect } from 'vitest'
import { parse, resolve } from '../src/index.js'
import type { CrossRef, Paragraph } from '../src/ast.js'

/*
 * A resolved crossref's display text is CLONED from the heading it points at,
 * so it is not a slice of the source the reference was written at. The clone carried
 * the heading's own positions, which put the heading's span inside the link's:
 * `</#getting-started>` at 23..42 with a child text node at 2..17, pointing at
 * a different construct entirely.
 *
 * PART 12 §4 lets a node whose content is not a contiguous slice of its own
 * source omit `pos` rather than invent one. That is this case exactly - and the
 * containment rule (carve#565) is what surfaced it: 5 corpus documents, all
 * crossrefs, none visible in any output.
 */
describe('a resolved crossref', () => {
  // The node stays a `heading_ref` through resolution (PART 12 §3a) and carries
  // its display text in `resolvedText`, which is the runtime-only field the
  // renderers read and `toAstJson` strips.
  const linkOf = (source: string): CrossRef => {
    const doc = resolve(parse(source, { positions: true }))
    const para = doc.children.find((n) => n.type === 'paragraph') as Paragraph
    const ref = para.children.find((n) => n.type === 'heading_ref') as CrossRef
    expect(ref).toBeDefined()
    expect(ref.href).toBeDefined()
    return ref
  }

  it('keeps its own span', () => {
    const link = linkOf('# Getting Started\n\nSee </#getting-started>.\n')
    expect(link.pos).toBeDefined()
    expect(link.pos!.startOffset).toBe(23)
  })

  it('does not give its cloned children the heading\'s positions', () => {
    const link = linkOf('# Getting Started\n\nSee </#getting-started>.\n')
    for (const child of link.resolvedText ?? []) {
      if (child.pos === undefined) continue
      expect(child.pos.startOffset).toBeGreaterThanOrEqual(link.pos!.startOffset)
      expect(child.pos.endOffset).toBeLessThanOrEqual(link.pos!.endOffset)
    }
  })

  it('still carries the heading text', () => {
    const link = linkOf('# Getting Started\n\nSee </#getting-started>.\n')
    const text = (link.resolvedText ?? []).map((c) => ('value' in c ? c.value : '')).join('')
    expect(text).toBe('Getting Started')
  })

  it('strips positions inside nested inline content too', () => {
    const link = linkOf('# A */b/* c\n\nSee </#a-b-c>.\n')
    const walk = (nodes: unknown[]): void => {
      for (const node of nodes as Array<Record<string, unknown>>) {
        if (node && typeof node === 'object') {
          if ('pos' in node && node.pos !== undefined) {
            const pos = node.pos as { startOffset: number; endOffset: number }
            expect(pos.startOffset).toBeGreaterThanOrEqual(link.pos!.startOffset)
            expect(pos.endOffset).toBeLessThanOrEqual(link.pos!.endOffset)
          }
          if (Array.isArray(node.children)) walk(node.children)
        }
      }
    }
    walk(link.resolvedText ?? [])
  })
})

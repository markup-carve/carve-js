// C2-H-208, C2-H-209: the render option headingShift beside the clause cases of the corpus.
import { describe, expect, it } from 'vitest'
import {
  CarveOptionError, CarveRenderError, format, lint, parse, render, renderWithDiagnostics, renderWithDocumentTransforms,
} from '../public/index.ts'
import { parseTree, renderTree, resolveTree } from '../src/index.ts'
import { toMarkdown, toPlainText } from '../public/export.ts'
import { importDocument } from '../import/src/index.ts'

const DOC = '= A\n\n> == Q\n\n::: note\n=== N\n:::\n\n- ==== L\n\n====== Deep\n'

/** A document of `n` sections, each with headings at every level and some text, for the shift-0 and scaling checks. */
function generated(seed: number, n: number): string {
  let state = seed
  const next = (limit: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % limit
  }
  const parts: string[] = []
  for (let at = 0; at < n; at++) {
    const level = 1 + next(6)
    const shapes = [`${'='.repeat(level)} H${at}`, `> ${'='.repeat(level)} Q${at}`, `- ${'='.repeat(level)} L${at}`,
      `:::\n${'='.repeat(level)} D${at}\n:::`, `Text ${at} with </#H${next(at + 1)}> and *s*.`, `{#x${at} .c}\n${'='.repeat(level)} I${at}`]
    parts.push(shapes[next(shapes.length)]!)
  }
  return `${parts.join('\n\n')}\n`
}

describe('headingShift', () => {
  it('shifts every heading at every depth and keeps text and ids', () => {
    const html = render(DOC, { headingShift: 2, sections: false })
    expect(html).toContain('<h3 id="A">A</h3>')
    expect(html).toContain('<h4 id="Q">Q</h4>')
    expect(html).toContain('<h5 id="N">N</h5>')
    expect(html).toContain('<h6 id="L">L</h6>')
    expect(html).toContain('<div role="heading" aria-level="8" id="Deep">Deep</div>')
  })

  it('shift 0 renders byte for byte as no option, on generated documents', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const source = generated(seed, 30)
      for (const extra of [{}, { roundtrip: true }, { sections: false }, { profile: 'comment' as const }]) {
        expect(renderWithDiagnostics(source, { ...extra, headingShift: 0 }), `${seed}`).toEqual(renderWithDiagnostics(source, extra))
      }
    }
  })

  it('the staged calls shift as render does, and a supplied tree is not changed', () => {
    const tree = parse(DOC)
    const before = JSON.stringify(tree)
    const options = { headingShift: 1 }
    expect(renderTree(resolveTree(parseTree(DOC), options))).toBe(render(DOC, options))
    expect(renderTree(resolveTree(tree, options))).toBe(render(DOC, options))
    expect(render(tree, options)).toBe(render(DOC, options))
    expect(render(tree, options)).toBe(render(DOC, options))
    expect(JSON.stringify(tree)).toBe(before)
    const parsed = parseTree(DOC)
    expect(renderTree(resolveTree(parsed, options))).toBe(render(DOC, options))
    expect(renderTree(resolveTree(parsed, options))).toBe(render(DOC, options))
    expect(renderTree(resolveTree(parsed, { headingShift: 3 }))).toBe(render(DOC, { headingShift: 3 }))
    expect(renderTree(resolveTree(parsed))).toBe(render(DOC))
  })

  it('renderWithDocumentTransforms shifts with no transform at all', () => {
    expect(renderWithDocumentTransforms('===== A\n', [], { headingShift: 2 })).toEqual(renderWithDiagnostics('===== A\n', { headingShift: 2 }))
  })

  it('runs before a host transform passed to renderWithDocumentTransforms', () => {
    const seen: number[] = []
    renderWithDocumentTransforms('= A\n', [{ name: 'host.levels', transform(view) {
      for (const node of view.children) if (node.type === 'heading') seen.push(node.level)
      return view
    } }], { headingShift: 3 })
    expect(seen).toEqual([4])
  })

  it('the loss of a level above 6 fails strictLosses and is left out by allowLosses', () => {
    expect(() => render('====== A\n', { headingShift: 1, strictLosses: true })).toThrow(CarveRenderError)
    expect(renderWithDiagnostics('====== A\n', { headingShift: 1, allowLosses: ['heading-shift-above-6'], strictLosses: true }))
      .toEqual({ html: '<section id="A">\n  <div role="heading" aria-level="7">A</div>\n</section>', diagnostics: [], suppressedDiagnostics: 0 })
  })

  it('a shifted roundtrip render imports back to the authored levels', () => {
    const html = render(DOC, { headingShift: 3, roundtrip: true })
    expect(importDocument(html, { from: 'html' }).source).toBe(importDocument(render(DOC, { roundtrip: true }), { from: 'html' }).source)
  })

  it('parse, format and lint refuse it', () => {
    expect(() => parse('= A\n', { headingShift: 1 } as never)).toThrow(CarveOptionError)
    expect(() => format('= A\n', { headingShift: 1 } as never)).toThrow(CarveOptionError)
    expect(() => lint('= A\n', { headingShift: 1 } as never)).toThrow(CarveOptionError)
  })

  it('the Markdown export shifts and clamps; the plain-text export refuses it', () => {
    expect(toMarkdown(parse('= A\n\n====== B\n'), { headingShift: 2 }).output).toBe('### A\n\n###### B\n')
    expect(() => toPlainText(parse('= A\n'), { headingShift: 0 } as never)).toThrow(CarveOptionError)
    expect(() => toMarkdown(parse('= A\n'), { headingShift: 6 })).toThrow(CarveOptionError)
  })

  it('records the above-six warning at the shift before later level edits', () => {
    const lower = renderWithDocumentTransforms('====== A\n', [{ name: 'sample.lower', transform(view) {
      const heading = view.children[0]!
      if (heading.type === 'heading') heading.level = 2
      return view
    } }], { headingShift: 1, roundtrip: true, sections: false, headingIds: 'off' })
    expect(lower.html).toBe('<h2 data-carve-source-level="1">A</h2>')
    expect(lower.diagnostics.map(d => d.code)).toEqual(['heading-shift-above-6'])
    expect(lower.diagnostics[0]?.message).toBe('The heading shift of 1 raises a heading above level 6.')
    const raise = renderWithDocumentTransforms('= A\n', [{ name: 'sample.raise', transform(view) {
      const heading = view.children[0]!
      if (heading.type === 'heading') heading.level = 7
      return view
    } }], { headingShift: 1, roundtrip: true, sections: false, headingIds: 'off' })
    expect(raise.html).toBe('<div data-carve-source-level="6" role="heading" aria-level="7">A</div>')
    expect(raise.diagnostics.map(d => d.code)).toEqual([])
  })

  it('writes the ruled carrier for inserted and below-shift headings', () => {
    const options = { headingShift: 1, roundtrip: true, sections: false, headingIds: 'off' as const }
    const added = renderWithDocumentTransforms('= A\n', [{ name: 'sample.add', transform(view) {
      view.children.push(parse('=== B\n', { headingIds: 'off' }).children[0]!)
      return view
    } }], options)
    expect(added.html).toBe('<h2 data-carve-source-level="1">A</h2>\n<h3 data-carve-source-level="2">B</h3>')
    const zero = renderWithDocumentTransforms('= A\n', [{ name: 'sample.zero', transform(view) {
      const heading = view.children[0]!
      if (heading.type === 'heading') heading.level = 1
      return view
    } }], options)
    expect(zero.html).toBe('<h1 data-carve-source-level="0">A</h1>')
  })

  it('scales linearly with the shift on', () => {
    const time = (n: number): number => {
      const source = generated(7, n)
      const start = performance.now()
      for (let run = 0; run < 3; run++) render(source, { headingShift: 1, roundtrip: true })
      return performance.now() - start
    }
    time(500)
    expect(time(8000) / Math.max(time(1000), 1)).toBeLessThan(24)
  })
})

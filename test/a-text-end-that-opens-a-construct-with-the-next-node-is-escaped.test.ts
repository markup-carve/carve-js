import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, parse, renderCarve, renderHtml, type Document } from '../src/index.js'

// A text node's last character and the next node's first can open a construct
// neither holds: `^[` an inline note, `$` before a backtick run inline math
// (carve-js#1795, markup-carve/carve-php#2061).

// Replaces the placeholder text `Q` with `value`, building a tree no source spells.
const withText = (template: string, value: string): Document => {
  const doc = parse(template)
  let found = 0
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const typed = node as { type?: string; value?: string }
    if (typed.type === 'text' && typed.value?.endsWith('Q')) {
      typed.value = typed.value.slice(0, -1) + value
      found++
    }
    for (const child of Object.values(node)) walk(child)
  }
  walk(doc)
  expect(found).toBe(1)
  return doc
}

describe('the writer at a text node boundary', () => {
  it.each([
    ['a caret before a link', 'xQ[n](u)\n', '^', 'x\\^[n](u)\n'],
    ['a caret before a span', 'xQ[n]{.k}\n', '^', 'x\\^[n]{.k}\n'],
    ['a caret before a note reference', 'xQ[^1]\n\n[^1]: d\n', '^', 'x\\^[^1]\n\n[^1]: d\n'],
    ['a dollar before a code span', 'xQ`c`\n', '$', 'x\\$`c`\n'],
    ['a dollar before inline math', 'xQ$`m`\n', '$', 'x\\$$`m`\n'],
    ['a dollar before a raw inline', 'xQ`r`{=html}\n', '$', 'x\\$`r`{=html}\n'],
    ['a literal backslash then a caret before a link', 'xQ[n](u)\n', '\\^', 'x\\\\\\^[n](u)\n'],
  ])('escapes %s', (_, template, value, written) => {
    const doc = withText(template, value)
    const carve = renderCarve(doc)
    expect(carve).toBe(written)
    expect(carveToHtml(carve)).toBe(renderHtml(doc))
    expect(carveToCarve(carve)).toBe(carve)
  })

  // `*b*` in the text needs its escape, so the node is written conservatively
  // and the boundary rule is the only thing left deciding the last character.
  it.each([
    ['an escaped caret before a link', 'Q[n](u)\n', '*b* x{^', '\\*b* x{\\^[n](u)\n'],
    ['a caret before a strong', 'Q{*s*}\n', '*b* x^', '\\*b* x^*s*\n'],
    ['a dollar before a link', 'Q[n](u)\n', '*b* x$', '\\*b* x$[n](u)\n'],
  ])('in a conservatively written text, writes %s', (_, template, value, written) => {
    expect(renderCarve(withText(template, value))).toBe(written)
  })

  it('leaves a caret before an empty span bare, which opens no note', () => {
    expect(carveToCarve('x ^[]{.c}\n')).toBe('x ^[]{.c}\n')
  })
})

describe('the HTML importer at a text node boundary', () => {
  it.each([
    ['a caret before a link', '<p>x ^<a href="u">n</a></p>', 'x \\^[n](u)\n'],
    ['a caret before a span', '<p>x^<span class="k">n</span></p>', 'x\\^[n]{.k}\n'],
    ['a dollar before a code element', '<p>x$<code>c</code></p>', 'x\\$`c`\n'],
    ['a dollar before inline math', '<p>x$<span class="math inline">\\(m\\)</span></p>', 'x\\$$`m`\n'],
  ])('escapes %s', (_, html, carve) => {
    const written = htmlToCarve(html).value
    expect(written).toBe(carve)
    expect(carveToHtml(written)).toBe(renderHtml(htmlToAst(html).value))
  })
})

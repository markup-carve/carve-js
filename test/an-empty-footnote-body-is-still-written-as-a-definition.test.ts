import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi, parse } from '../src/index.js'

/**
 * PART 11 §1: `to_html(fmt(x)) == to_html(x)`.
 *
 * `[^f]: {x}` defines a footnote whose body is EMPTY: the brace line is
 * consumed as a block attribute and there is no block under it to attach to, so
 * nothing is left. The writer emitted `[^f]:`, which is not a footnote
 * definition - and both the definition and its reference came back as literal
 * text, with the endnote section gone (markup-carve/carve-js#904).
 *
 * AN EMPTY BODY IS NOT SPELLABLE. The grammar's
 * `footnote_definition = "[^", label, "]:", space+, inline_content` takes
 * `inline_content` as one-or-more, so a definition always has content and
 * `[^f]:` / `[^f]: ` are paragraphs. The state is reachable only through the
 * attribute line that produced it, so that is what the writer emits back.
 */

const targets = [
  ['HTML', carveToHtml],
  ['Markdown', carveToMarkdown],
  ['plain text', carveToPlainText],
  ['ANSI', carveToAnsi],
] as const

describe('an empty footnote body is written in a form that still defines', () => {
  const src = '[^f]: {x}\n\nr[^f]\n'

  it('the body really is empty, which is what makes this unspellable', () => {
    expect(parse(src).footnoteDefs?.['f']).toEqual([])
  })

  it('neither `[^f]:` nor `[^f]: ` parses as a definition', () => {
    // The reason a placeholder is owed at all. If either of these ever defines,
    // this fix has a cheaper form and this row says so.
    for (const attempt of ['[^f]:\n\nr[^f]\n', '[^f]: \n\nr[^f]\n']) {
      expect(parse(attempt).footnoteDefs).toBeUndefined()
    }
  })

  it('the reference and the endnote survive the round trip', () => {
    expect(carveToCarve(src)).toBe('r[^f]\n\n[^f]: {empty}\n')
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
    expect(carveToHtml(carveToCarve(src))).toContain('role="doc-endnotes"')
    expect(carveToHtml(carveToCarve(src))).not.toContain('<p>r[^f]</p>')
  })

  it('holds on every target, not just HTML', () => {
    // A `%%` comment and a `%%%` block body both round-trip on three targets
    // and move the HTML by one newline inside the `<li>`. Only a block
    // attribute line renders to nothing everywhere, which is why it is the one
    // chosen - so all four are asserted.
    for (const [name, render] of targets) {
      expect(render(carveToCarve(src)), name).toBe(render(src))
    }
  })

  it('the particular attribute does not matter, the emptiness does', () => {
    for (const payload of ['{x}', '{#i}', '{.c}', '{a=b}']) {
      const s = `[^f]: ${payload}\n\nr[^f]\n`
      expect(carveToCarve(s), payload).toBe('r[^f]\n\n[^f]: {empty}\n')
      expect(carveToHtml(carveToCarve(s)), payload).toBe(carveToHtml(s))
    }
  })

  it('the definition-list description writer takes the same path', () => {
    // A definition written on a description line goes through the same helper,
    // and a second spelling of the empty-body rule would be a rule with two
    // implementations.
    const s = 't\n: d [^f]\n\n[^f]: {x}\n'
    expect(carveToHtml(carveToCarve(s))).toBe(carveToHtml(s))
  })

  it('is idempotent', () => {
    const once = carveToCarve(src)
    expect(carveToCarve(once)).toBe(once)
  })

  it('CONTROL: a body with text before the attribute line is not empty', () => {
    // The sharp control: it shows the defect is the EMPTY body, not the
    // presence of a brace block. No mutation of the placeholder moves it.
    expect(carveToCarve('[^f]: t {x}\n\nr[^f]\n')).toBe('r[^f]\n\n[^f]: t {x}\n')
    expect(carveToCarve('[^f]: t\n\nr[^f]\n')).toBe('r[^f]\n\n[^f]: t\n')
  })

  it('CONTROL: the link-reference and abbreviation writers were measured, and are safe', () => {
    // Each was named as having "its own empty-value case". Measured, neither
    // does: `[a]: {x}` is not a definition at all, so nothing is emptied, and
    // an abbreviation keeps `{x}` as its expansion text.
    expect(parse('[a]: {x}\n\n[a][]\n').children.every((c) => c.type !== 'link_reference_definition')).toBe(true)
    for (const s of ['[a]: {x}\n\n[a][]\n', '*[T]: {x}\n\nT\n', '[a]: /u\n\n[a][]\n', '*[T]: e\n\nT\n']) {
      expect(carveToHtml(carveToCarve(s)), s).toBe(carveToHtml(s))
    }
  })

  it('CONTROL: a bare attribute line at top level still formats to nothing', () => {
    // The behavior this fix deliberately does NOT change: at document level the
    // line is dropped and the document is empty on both sides.
    expect(carveToHtml('{x}\n')).toBe('')
    expect(carveToHtml(carveToCarve('{x}\n'))).toBe('')
  })
})

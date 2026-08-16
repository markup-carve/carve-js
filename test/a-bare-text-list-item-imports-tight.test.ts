/*
 * List tightness on HTML import, as ruled (spec docs/html-import.md "Lists keep
 * the source's tightness"; corpus-convert 27/28): a bare-text `<li>one</li>` is
 * a TIGHT list item, a paragraph-wrapped `<li><p>one</p></li>` a loose one, and
 * import preserves what the source spelled rather than normalizing it.
 *
 * Carve spells tightness per LIST, not per item, so a MIXED list has to resolve
 * one way, and it resolves the way CommonMark resolves it: ONE paragraph item
 * loosens the whole list. Resolving tight instead would drop the paragraph that
 * item actually spelled.
 *
 * Both directions are pinned here on purpose. An assertion that only proves the
 * tight half flips the bug rather than fixing it.
 */
import { describe, it, expect } from 'vitest'
import { htmlToCarve, htmlToAst, carveToHtml } from '../src/index.js'
import type { List } from '../src/ast.js'

const imp = (html: string): string => htmlToCarve(html).value

/** The `tight` flag of the first list in the imported AST, sublists included. */
const tightFlags = (html: string): boolean[] => {
  const found: boolean[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.type === 'list') found.push((record as unknown as List).tight)
    for (const key of Object.keys(record)) walk(record[key])
  }
  walk(htmlToAst(html).value)
  return found
}

describe('list tightness survives HTML import', () => {
  it('an all-bare-text list imports tight (corpus-convert 27)', () => {
    const html = '<ul><li>one</li><li>two</li></ul>'
    expect(imp(html)).toBe('- one\n- two\n')
    expect(carveToHtml(imp(html))).toBe('<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>')
    expect(tightFlags(html)).toEqual([true])
  })

  it('a mixed list stays loose (corpus-convert 28)', () => {
    // One paragraph item loosens the whole list. Resolving tight would drop
    // the `<p>` item two spelled.
    const html = '<ul><li>one</li><li><p>two</p></li></ul>'
    expect(imp(html)).toBe('- one\n\n- two\n')
    expect(carveToHtml(imp(html))).toBe('<ul>\n  <li><p>one</p></li>\n  <li><p>two</p></li>\n</ul>')
    expect(tightFlags(html)).toEqual([false])
  })

  it('a mixed list stays loose when the FIRST item carries the paragraph', () => {
    // Position must not matter: the vote is over the whole list, not the head.
    const html = '<ul><li><p>one</p></li><li>two</li></ul>'
    expect(imp(html)).toBe('- one\n\n- two\n')
    expect(tightFlags(html)).toEqual([false])
  })

  it('an all-paragraph list stays loose', () => {
    expect(imp('<ul><li><p>one</p></li><li><p>two</p></li></ul>')).toBe('- one\n\n- two\n')
    expect(tightFlags('<ul><li><p>one</p></li><li><p>two</p></li></ul>')).toEqual([false])
  })

  it('an ordered mixed list stays loose too', () => {
    const html = '<ol><li>one</li><li><p>two</p></li></ol>'
    expect(imp(html)).toBe('1. one\n\n2. two\n')
    expect(tightFlags(html)).toEqual([false])
  })

  it('a single-item list imports the tightness its one item spells', () => {
    // A one-item list has no gap to spell looseness with, so both shapes
    // serialize to the same Carve bytes. The imported AST still carries what
    // the source said, which is what this asserts.
    expect(tightFlags('<ul><li>one</li></ul>')).toEqual([true])
    expect(tightFlags('<ul><li><p>one</p></li></ul>')).toEqual([false])
    expect(imp('<ul><li>one</li></ul>')).toBe('- one\n')
  })

  it('a nested sublist does not make its host item loose', () => {
    // The item's own text is bare; the `<ul>` beside it is structure, not a
    // paragraph wrapper.
    expect(imp('<ul><li>one<ul><li>sub</li></ul></li><li>two</li></ul>')).toBe(
      '- one\n  - sub\n- two\n',
    )
    expect(tightFlags('<ul><li>one<ul><li>sub</li></ul></li><li>two</li></ul>')).toEqual([
      true,
      true,
    ])
  })

  it('a nested list resolves each level on its own items', () => {
    // Looseness is decided per level: an inner paragraph item loosens the
    // sublist without loosening its bare-text parent.
    const innerLoose = '<ul><li>one<ul><li>a</li><li><p>b</p></li></ul></li><li>two</li></ul>'
    expect(tightFlags(innerLoose)).toEqual([true, false])
    expect(imp(innerLoose)).toBe('- one\n  - a\n\n  - b\n- two\n')

    const outerLoose = '<ul><li><p>one</p><ul><li>a</li><li>b</li></ul></li><li>two</li></ul>'
    expect(tightFlags(outerLoose)).toEqual([false, true])
    expect(imp(outerLoose)).toBe('- one\n\n  - a\n  - b\n\n- two\n')
  })

  it('a block item that is not a paragraph does not loosen the list', () => {
    // Only a `<p>` spells looseness. Deciding this as "every item is bare
    // text" instead loosens these four, each of which then re-renders with a
    // `<p>` around `one` that the source never spelled - the same loss the
    // rule exists to prevent, in the other direction.
    for (const html of [
      '<ul><li>one</li><li><blockquote><p>q</p></blockquote></li></ul>',
      '<ul><li>one</li><li><pre><code>x</code></pre></li></ul>',
      '<ul><li>one</li><li></li></ul>',
      '<ul><li>one</li><li><ul><li>a</li></ul></li></ul>',
    ]) {
      expect(tightFlags(html)[0], html).toBe(true)
      expect(carveToHtml(imp(html)), html).not.toContain('<li><p>one</p></li>')
    }
  })

  it('the consumed checkbox input does not decide tightness', () => {
    // The `<input>` is consumed into the `[x]` marker rather than imported, so
    // a task list of bare items is still tight.
    expect(
      imp('<ul class="task-list"><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>'),
    ).toBe('{.task-list}\n- [x] done\n- [ ] open\n')
  })

  it('the engine of both looseness spellings round-trips through its own HTML', () => {
    expect(imp(carveToHtml('- one\n- two\n'))).toBe('- one\n- two\n')
    expect(imp(carveToHtml('- one\n\n- two\n'))).toBe('- one\n\n- two\n')
  })
})

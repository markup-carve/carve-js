import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, fromAstJson, htmlToCarve, renderCarve } from '../src/index.js'

const NOT_LAST = '<dl><dt>t1</dt><dd></dd><dt>t2</dt><dd>d2</dd></dl>'
const LAST = '<dl><dt>t1</dt><dd>d1</dd><dt>t2</dt><dd></dd></dl>'

/** ONE list, four items, the empty `<dd>` among them. */
const ingested = (items: unknown[]) =>
  fromAstJson({
    type: 'document',
    srcByteLength: 0,
    children: [{ type: 'definition_list', items }],
  })

const term = (value: string) => ({ type: 'definition_term', children: [{ type: 'text', value }] })
const empty = { type: 'definition_description', children: [] }
const described = (value: string) => ({
  type: 'definition_description',
  children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
})

/**
 * A definition description whose body holds no blocks is written `: {empty}`,
 * the sentinel PART 11 §7b already uses for an empty footnote definition
 * (markup-carve/carve#1827).
 *
 * The line is a block-attribute line: the block it would attach to does not
 * exist, so the parse consumes it and the description reads back holding
 * nothing. That makes it a fixed point in EVERY position - the writer needs no
 * lookahead over what follows.
 */
describe('an empty description body is written with the {empty} sentinel', () => {
  it('writes the sentinel for a description holding no blocks', () => {
    expect(carveToCarve(':: t\n: {empty}\n')).toBe(':: t\n: {empty}\n')
  })

  it('renders an empty <dd>', () => {
    expect(carveToHtml(':: t\n: {empty}\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>')
  })

  /**
   * THE THREE POSITIONS. `: +` renders an empty `<dd>` too, but a `+` ATTACHES
   * the column-0 block under it, so it is only empty with a blank line after
   * it. The sentinel is empty in all three, which is why it needs no lookahead.
   */
  it.each([
    ['at end of input', ':: t\n: {empty}\n'],
    ['above a blank line', ':: t\n: {empty}\n\nflush\n'],
  ])('is a fixed point %s', (_name, source) => {
    expect(carveToCarve(source)).toBe(source)
  })

  /**
   * The writer separates blocks with a blank line, so the flush-left spelling
   * is not a fixed point - but the sentinel is empty either way, so the
   * rendering does not move and `toHtml(fmt(x)) == toHtml(x)` holds.
   */
  it.each([
    ['at end of input', ':: t\n: {empty}\n'],
    ['above a blank line', ':: t\n: {empty}\n\nflush\n'],
    ['above a flush-left paragraph', ':: t\n: {empty}\nflush\n'],
  ])('renders the same after a round trip %s', (_name, source) => {
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('leaves the description empty with a flush-left paragraph under it', () => {
    expect(carveToHtml(':: t\n: {empty}\nflush\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>flush</p>',
    )
  })

  /**
   * ONE LIST, FOUR CHILDREN. Consecutive `::` lines share the description
   * written below them, so the entry has to be written for the term above it to
   * keep its own - which is what the sentinel does, in the middle of a list as
   * much as at its end.
   */
  it('keeps a list whose empty entry is not the last one whole', () => {
    expect(htmlToCarve(NOT_LAST).value).toBe(':: t1\n: {empty}\n:: t2\n: d2\n')
    expect(carveToHtml(htmlToCarve(NOT_LAST).value)).toBe(
      '<dl>\n  <dt>t1</dt>\n  <dd></dd>\n  <dt>t2</dt>\n  <dd>d2</dd>\n</dl>',
    )
  })

  it('keeps a list whose empty entry is the last one whole', () => {
    expect(htmlToCarve(LAST).value).toBe(':: t1\n: d1\n:: t2\n: {empty}\n')
    expect(carveToHtml(htmlToCarve(LAST).value)).toBe(
      '<dl>\n  <dt>t1</dt>\n  <dd>d1</dd>\n  <dt>t2</dt>\n  <dd></dd>\n</dl>',
    )
  })

  it('declares no loss for an empty <dd>', () => {
    const codes = htmlToCarve(NOT_LAST).report.diagnostics.map((d) => d.code)
    expect(codes).not.toContain('structure-unspellable')
    expect(codes).not.toContain('structure-split')
  })

  /**
   * THE CONDITION IS "THIS ENTRY WRITES NOTHING", not "the description is
   * empty": an ingested tree, a paragraph with no visible text, and a list with
   * no items all write nothing and all take the sentinel.
   */
  it.each([
    ['no children', []],
    ['an invisible paragraph', [{ type: 'paragraph', children: [] }]],
    ['a list with no items', [{ type: 'list', ordered: false, tight: true, items: [] }]],
  ])('takes the sentinel for a description holding %s', (_name, children) => {
    const doc = ingested([term('t'), { type: 'definition_description', children }])
    expect(renderCarve(doc)).toBe(':: t\n: {empty}\n')
  })

  it('writes the sentinel for an ingested list whose empty entry is not last', () => {
    const doc = ingested([term('t1'), empty, term('t2'), described('d2')])
    expect(renderCarve(doc)).toBe(':: t1\n: {empty}\n:: t2\n: d2\n')
  })

  /**
   * THE SENTINEL DOES NOT EAT CONTENT. `{empty}` is only a sentinel where it is
   * the whole line and reads as a block-attribute line; escaped, or with text
   * beside it, it is ordinary content and stays one.
   */
  it.each([
    ['escaped', ':: t\n: \\{empty}\n', '<dl>\n  <dt>t</dt>\n  <dd>{empty}</dd>\n</dl>'],
    ['with text beside it', ':: t\n: {empty} x\n', '<dl>\n  <dt>t</dt>\n  <dd>{empty} x</dd>\n</dl>'],
  ])('keeps %s as content', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
    expect(carveToCarve(source)).toBe(source)
  })
})

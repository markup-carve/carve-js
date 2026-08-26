import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToHtml, lintCarve, parse, renderHtml, resolve } from '../src/index.js'
import type { Document } from '../src/ast.js'

/*
 * `ParseOptions.positions` was declared, documented, written by four call sites
 * and read by none, so `parse(src, { positions: false })` came back with a `pos`
 * on every node (carve-js#1263). PART 12 section 4 permits the gate - "position
 * tracking may be opt-in, serialization may not" - so it is honored rather than
 * removed, with the default staying true.
 *
 * The interesting half is what does NOT honor it. Three entry points read
 * positions to decide something, so they force the option back on; the figure
 * one is the reason `carveToHtml` forces them even without `sourceLine`.
 */

const POSITION_FIELDS = ['pos', 'footnoteDefPos', 'termSpans', 'definitionSpans', 'definitionLines']

/** Every position-bearing field found anywhere in a tree, by name. */
function positionFieldsIn(value: unknown, found: string[] = [], seen = new Set<object>()): string[] {
  if (!value || typeof value !== 'object') return found
  if (seen.has(value)) return found
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) positionFieldsIn(item, found, seen)
    return found
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (POSITION_FIELDS.includes(key)) found.push(key)
    positionFieldsIn(record[key], found, seen)
  }
  return found
}

function stripPositionFields(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) stripPositionFields(item, seen)
    return
  }
  const record = value as Record<string, unknown>
  for (const field of POSITION_FIELDS) delete record[field]
  for (const key of Object.keys(record)) stripPositionFields(record[key], seen)
}

/*
 * One document per position-bearing field: a footnote fills `footnoteDefPos`,
 * a definition list fills `termSpans`, `definitionSpans` and `definitionLines`,
 * and the prose fills `pos`.
 */
const SOURCE = [
  '# Title',
  '',
  'Some *bold* prose with a note.[^n]',
  '',
  '[^n]: The note body.',
  '',
  ':: term',
  ':  the definition',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
].join('\n')

describe('ParseOptions.positions', () => {
  it('places every node by default, exactly as before', () => {
    const doc = parse(SOURCE)
    const fields = positionFieldsIn(doc)
    expect(fields).toContain('pos')
    expect(fields).toContain('footnoteDefPos')
    expect(fields).toContain('termSpans')
    expect(fields).toContain('definitionSpans')
    expect(fields).toContain('definitionLines')
  })

  it('places every node with an explicit true', () => {
    expect(positionFieldsIn(parse(SOURCE, { positions: true }))).toContain('pos')
  })

  it('leaves no position of any kind with an explicit false', () => {
    expect(positionFieldsIn(parse(SOURCE, { positions: false }))).toEqual([])
  })

  it('suppresses inline positions too, not only block ones', () => {
    // The two layers gate on different values - `suppressPositions` for blocks,
    // `source.anchored` for inlines - so a fix that reached one and not the
    // other would still pass a block-only assertion.
    const doc = parse('x *b* y\n', { positions: false })
    const paragraph = doc.children[0] as { pos?: unknown; children: { pos?: unknown }[] }
    expect(paragraph.pos).toBeUndefined()
    expect(paragraph.children.map((child) => child.pos)).toEqual([undefined, undefined, undefined])
  })

  it('does not change a single parse decision', () => {
    // The option is a preference about what the tree CARRIES. Compared after
    // stripping, the two trees must be identical - if suppressing positions
    // moved a parse decision, the option would be a syntax switch.
    const positioned: Document = parse(SOURCE)
    const suppressed: Document = parse(SOURCE, { positions: false })
    stripPositionFields(positioned)
    expect(suppressed).toEqual(positioned)
  })
})

describe('the entry points that read positions force them back on', () => {
  it('carveToAstJson serializes positions even when handed false', () => {
    // PART 12 section 4 gates TRACKING and not serialization: what is forbidden
    // is a serialized document without positions.
    const json = carveToAstJson(SOURCE, { positions: false })
    expect(positionFieldsIn(json)).toContain('pos')
  })

  it('carveToHtml renders the same HTML whether or not positions were asked for', () => {
    expect(carveToHtml(SOURCE, { positions: false })).toBe(carveToHtml(SOURCE))
  })

  it('carveToHtml keeps the strict column-0 figure rule under positions: false', () => {
    // The rule reads the image's own `startColumn` and promotes when there is
    // no position - correct for an ingested tree, wrong for one just parsed.
    // Suppressing positions turned this paragraph into a figure.
    const indented = ' ![a](p.png)\n ^ cap\n'
    expect(carveToHtml(indented, { positions: false })).toBe('<p><img src="p.png" alt="a">\n^ cap</p>')
  })

  it('a hand-composed pipeline reaches the same answer as the entry point', () => {
    // THIS USED TO BE THE HAZARD, and the block-image promotion phase removed
    // it (carve-js#1552). Positions were an INPUT to the figure rule: the gate
    // read the image's own `startColumn` and promoted when there was none, so
    // parse+resolve+renderHtml with the option off built a figure the
    // convenience entry point left alone, and turning positions off silently
    // changed the parse.
    //
    // The phase does not read positions. Whether a paragraph began at its
    // container's content column is recorded by the parser, where the
    // indentation still exists, so the answer no longer depends on an option
    // about spans - and the two pipelines agree.
    const indented = ' ![a](p.png)\n ^ cap\n'
    expect(renderHtml(resolve(parse(indented, { positions: false })))).not.toContain('<figure>')
    expect(carveToHtml(indented)).not.toContain('<figure>')
  })

  it('carveToHtml still stamps source lines when handed false with sourceLine', () => {
    const html = carveToHtml('# Title\n', { sourceLine: true, positions: false })
    expect(html).toContain('data-source-line="1"')
  })

  it('lintCarve still reports, since its own parse forces positions on', () => {
    const warnings = lintCarve('[missing]\n\nSee [broken][nowhere].\n')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.every((w) => typeof w.start === 'number')).toBe(true)
  })
})

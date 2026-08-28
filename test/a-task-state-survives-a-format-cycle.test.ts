import { describe, it, expect } from 'vitest'
import { parse, renderCarve, toAstJson, fromAstJson, carveToHtml } from '../src/index.js'

const fmt = (s: string) => renderCarve(parse(s))

/**
 * PART 11 §6g / carve#1866. The seven task states render as two, so the tree
 * carried only `checked` and `fmt` rewrote four of them to `[ ]`. The state is
 * the author's spelling, recorded like `bulletChar`.
 */
describe('a task state survives a format cycle', () => {
  it.each(['-', '_', '>', '?'])('writes [%s] back', (state) => {
    expect(fmt(`- [${state}] a\n`)).toBe(`- [${state}] a\n`)
  })

  it('records the state only when it is not the default for the box', () => {
    const items = (src: string) => (parse(src).children[0] as never as { items: unknown[] }).items
    expect(items('- [ ] a')[0]).not.toHaveProperty('taskState')
    expect(items('- [x] a')[0]).not.toHaveProperty('taskState')
    expect(items('- [-] a')[0]).toMatchObject({ checked: false, taskState: '-' })
  })

  it('folds [X] to [x], which is a case and not a state', () => {
    expect(fmt('- [X] a\n')).toBe('- [x] a\n')
    expect(toAstJson(parse('- [X] a'))).toEqual(toAstJson(parse('- [x] a')))
  })

  it('carries the state through the AST-JSON round trip', () => {
    const source = '- [>] deferred\n'
    expect(renderCarve(fromAstJson(toAstJson(parse(source))))).toBe(source)
  })

  it('leaves the rendering alone: every state but x renders unchecked', () => {
    expect(carveToHtml('- [>] a')).toContain('<input type="checkbox" disabled aria-label="a"> a')
  })

  it('writes the state on an item that also carries attributes', () => {
    expect(fmt('-{.c} [?] a\n')).toBe('-{.c} [?] a\n')
  })
})

describe('the two task fields cannot disagree on ingest', () => {
  const payload = (item: Record<string, unknown>) => ({
    type: 'document',
    srcByteLength: 0,
    children: [
      { type: 'list', ordered: false, tight: true, items: [{ type: 'list_item', children: [], ...item }] },
    ],
  })

  it('refuses a dropped state on a ticked box', () => {
    expect(() => fromAstJson(payload({ checked: true, taskState: '-' }))).toThrow(/taskState/)
  })

  it('refuses a state on an item that is not a task', () => {
    expect(() => fromAstJson(payload({ taskState: '?' }))).toThrow(/taskState/)
  })

  it('accepts the pair the schema admits', () => {
    expect(() => fromAstJson(payload({ checked: false, taskState: '?' }))).not.toThrow()
  })
})

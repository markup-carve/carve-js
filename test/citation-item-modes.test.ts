import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, citations, diffAst, fromAstJson, parse, renderDocument, toAstJson } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'
import { SourceUnspellableError } from '../src/source-unspellable-error.js'

const extension = citations({ mode: 'author-date' })
const source = 'See [@a; @b].\n\n[@a]: {author="Ada" year="2020"} A.\n[@b]: {author="Bea" year="2021"} B.\n'

function citationGroup(tree: ReturnType<typeof toAstJson>): {
  mode?: 'integral'
  items: Array<{ mode?: 'integral' }>
} {
  const paragraph = tree.children[0] as { children: unknown[] }
  return paragraph.children.find((node) => (node as { type?: string }).type === 'citation_group') as never
}

describe('per-item citation modes', () => {
  it('copies an authored integral mode to every item', () => {
    const tree = toAstJson(parse('[+@a; @b]', { extensions: [extension] }))
    expect(citationGroup(tree).mode).toBe('integral')
    expect(citationGroup(tree).items.map((item) => item.mode)).toEqual(['integral', 'integral'])
    expect(renderCarve(fromAstJson(tree))).toContain('[+@a; @b]')
  })

  it('preserves mixed item modes through JSON and renders the integral item', () => {
    const tree = toAstJson(parse(source, { extensions: [extension] }))
    citationGroup(tree).items[0]!.mode = 'integral'
    const parenthetical = toAstJson(parse(source, { extensions: [extension] }))
    expect(diffAst(parenthetical, tree).some((change) => JSON.stringify(change).includes('mode'))).toBe(true)
    const decoded = fromAstJson(JSON.parse(JSON.stringify(tree)))
    expect(toAstJson(decoded)).toEqual(tree)
    const html = renderDocument(decoded, { extensions: [extension] })
    expect(html).toMatch(/<span class="citation" data-cite-mode="integral">[^]*?data-cite-key="a"[^]*?<\/span>/)
    expect(html.match(/data-cite-mode="integral"/g)).toHaveLength(1)
    expect(() => renderCarve(decoded)).toThrow(SourceUnspellableError)
  })

  it('uses an absent item mode even when the imported group says integral', () => {
    const tree = toAstJson(parse('[+@a; @b]' + source.slice(source.indexOf('\n\n')), { extensions: [extension] }))
    delete citationGroup(tree).items[1]!.mode
    const decoded = fromAstJson(tree)
    expect(toAstJson(decoded)).toEqual(tree)
    const html = renderDocument(decoded, { extensions: [extension] })
    expect(html.match(/data-cite-mode="integral"/g)).toHaveLength(1)
    expect(html).toMatch(/<span class="citation" data-cite-mode="integral">[^]*?data-cite-key="a"[^]*?<\/span>/)
    expect(() => renderCarve(decoded)).toThrow(SourceUnspellableError)
  })

  it('spells uniform imported modes from the items', () => {
    const integral = toAstJson(parse('[@a; @b]', { extensions: [extension] }))
    for (const item of citationGroup(integral).items) item.mode = 'integral'
    expect(renderCarve(fromAstJson(integral))).toContain('[+@a; @b]')

    const parenthetical = toAstJson(parse('[+@a; @b]', { extensions: [extension] }))
    for (const item of citationGroup(parenthetical).items) delete item.mode
    const decoded = fromAstJson(parenthetical)
    expect(renderDocument(decoded, { extensions: [extension] })).not.toContain('data-cite-mode="integral"')
    expect(renderCarve(decoded)).toContain('[@a; @b]')
  })

  it.each(['parenthetical', null, false, 1])('rejects malformed item mode %s', (mode) => {
    const tree = toAstJson(parse(source, { extensions: [extension] }))
    ;(citationGroup(tree).items[0] as { mode: unknown }).mode = mode
    expect(() => fromAstJson(tree)).toThrow(AstJsonSchemaError)
  })
})

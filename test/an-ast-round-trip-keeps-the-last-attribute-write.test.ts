import { describe, expect, it } from 'vitest'

import { fromAstJson, parse, renderHtml, toAstJson, type AstJsonDocument } from '../src/index.js'

/*
 * markup-carve/carve#5988: `{#a ID=b #c}` and `{#a #c ID=b}` render different
 * ids, so their trees must encode differently (PART 12 §6). `order` lists the
 * last-written slot again where a folded name does not end on it, and the
 * decoder replays `order` as the write sequence.
 */

const runs = [
  '#a ID=b #c', '#a ID=b', 'ID=b #a', 'ID=b #a ID=c', '#a Id=b #c',
  '#a #c ID=b', 'ID=b id=c', '#a id=b #c', 'title=a TITLE=b title=c', 'ID=b title=t #a ID=c',
  'TITLE=b title=a TITLE=c', 'x=1 X=2 y=3 Y=4 x=5', 'ID=a Id=b #c ID=d', 'ID=x Id=y ID=x #a', 'id=a ID=b',
]
const hosts: Record<string, string> = {
  'link': '[x](/u){%s}\n',
  'block line': '{%s}\npara\n',
  'image': 'y ![i](/p.png){%s}\n',
  'block image': '{%s}\n![i](/p.png)\n',
  'reference definition': '[x][r]\n\n[r]: /u {%s}\n',
  'admonition': '{%s}\n::: note\nbody\n:::\n',
  'span': '[t]{%s}\n',
  'heading': '{%s}\n# H\n',
  'table cell': '| [x](/u){%s} |\n',
}
const cases = Object.entries(hosts).flatMap(([host, template]) =>
  runs.map((run) => [`${host} {${run}}`, template.replace('%s', run)] as const))

const wire = (source: string): string => JSON.stringify(toAstJson(parse(source)))

describe('an AST round trip keeps the last attribute write', () => {
  it.each(cases)('%s renders like the parse', (_, source) => {
    const json = wire(source)
    const decoded = fromAstJson(JSON.parse(json))
    expect(renderHtml(decoded)).toBe(renderHtml(parse(source)))
    expect(JSON.stringify(toAstJson(decoded))).toBe(json)
  })

  it('lists the last-written slot again on the wire', () => {
    expect(wire('[x](/u){#a ID=b #c}\n')).toContain('"attrs":{"id":"c","keyValues":{"ID":"b"},"order":["#id","ID","#id"]}')
    expect(wire('[x](/u){#a #c ID=b}\n')).toContain('"attrs":{"id":"c","keyValues":{"ID":"b"},"order":["#id","ID"]}')
    expect(wire('[x](/u){#a id=b #c}\n')).toContain('"attrs":{"id":"c","order":["#id"]}')
    expect(wire('[x](/u){title=a TITLE=b title=c}\n')).toContain('"order":["title","TITLE","title"]')
  })

  it('reads the last write from order, not from keyValues member order', () => {
    const json = wire('[x](/u){title=a TITLE=b title=c}\n').replace('"keyValues":{"TITLE":"b","title":"c"}', '"keyValues":{"title":"c","TITLE":"b"}')
    expect(json).toContain('"keyValues":{"title":"c","TITLE":"b"},"order":["title","TITLE","title"]')
    const doc = JSON.parse(json) as AstJsonDocument
    expect(renderHtml(fromAstJson(doc))).toBe('<p><a href="/u" title="c">x</a></p>')
  })

  it('places a heading section at the id written last', () => {
    expect(renderHtml(parse('{#a ID=b}\n# H\n'))).toContain('<section id="b">')
    expect(renderHtml(parse('{#a #c ID=b}\n# H\n'))).toContain('<section id="b">')
  })
})

// Engine defects the conformance corpus of the specification found, each fixed at its clause.
import { describe, expect, it } from 'vitest'
import { checkWriter } from './support/writer-checks.ts'
import { CarveLayoutError, CarveTreeError, decodeTree, validateTreeWithAnnotations, encodeTree, format, parse, render, validateLayout, write } from '../src/index.ts'

const children = (src: string): unknown => (JSON.parse(encodeTree(parse(src, { positions: false }))) as { children: unknown }).children

describe('table rows', () => {
  it('C2-B-133, C2-B-167: a run of three percent signs behind the closing pipe starts a trailing line comment (CC-073)', () => {
    expect(render('| 1 | %%% x')).toBe('<table>\n  <tbody>\n    <tr><td>1</td></tr>\n  </tbody>\n</table>')
    const [table] = children('| 1 | %%%\nnext') as [{ children: unknown[] }]
    expect(table.children.at(-1)).toEqual({ type: 'comment', form: 'line', value: '%' })
    expect(render('| 1 |%%% x')).toBe('<p>| 1 |%%% x</p>')
  })
})

describe('link definitions', () => {
  it('C2-B-083, C2-I-013: the destination of a definition reads the escaped parenthesis and backslash (CC-044, CC-045)', () => {
    expect(children('[a]: /x\\)')).toEqual([{ type: 'link_reference_definition', key: 'a', namespace: 'link', href: '/x)' }])
    expect(children('[a]: \\\\')).toEqual([{ type: 'link_reference_definition', key: 'a', namespace: 'link', href: '\\' }])
    expect(children('[a]: /x\\y')).toEqual([{ type: 'link_reference_definition', key: 'a', namespace: 'link', href: '/x\\y' }])
    expect(render('[a]: /x\\(\n\n[b][a]')).toBe('<p><a href="/x(">b</a></p>')
  })

  it('C2-W-001, C2-I-013: the writer escapes a backslash of a definition destination that would read as an escape', () => {
    for (const href of ['\\', '/x\\(', '\\\\', '/x\\', 'a\\b']) {
      const tree = decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0', children: [
        { type: 'link_reference_definition', key: 'a', namespace: 'link', href }] }))
      const source = write(tree)
      expect(children(source)).toEqual(tree.children)
      expect(format(source)).toBe(source)
    }
  })
})

describe('quotes', () => {
  it('C2-H-006, C2-H-062: a quote whose one paragraph carries a caption is no one-line quote; the paragraph is a figure (CC-069)', () => {
    expect(render('> $$`x^2`\n> ^ Equation')).toBe([
      '<blockquote>', '  <figure>', '    <p><span class="math display" role="math">\\[x^2\\]</span></p>',
      '    <figcaption>Equation</figcaption>', '  </figure>', '</blockquote>',
    ].join('\n'))
  })
})

describe('captioned paragraphs in items and descriptions', () => {
  it('C2-H-062, C2-H-007, C2-H-040: a captioned math paragraph alone in an item or a description keeps its figure', () => {
    const figure = ['<figure>', '  <p><span class="math display" role="math">\\[x\\]</span></p>', '  <figcaption>cap</figcaption>', '</figure>']
    const inside = (level: string): string[] => figure.map((text) => level + text)
    expect(render('- $$`x`\n  ^ cap')).toBe(['<ul>', '  <li>', ...inside('    '), '  </li>', '</ul>'].join('\n'))
    expect(render(':: t\n: $$`x`\n  ^ cap')).toBe(['<dl>', '  <dt>t</dt>', '  <dd>', ...inside('    '), '  </dd>', '</dl>'].join('\n'))
  })
})

describe('the layout sidecar', () => {
  const sidecar = (encoding: string, source: string, endByte: number): unknown => ({ version: 2, encoding, source, lineEndings: 'none',
    bom: false, nodes: [{ path: '/children/0', startByte: 0, endByte, blankLinesBefore: 0, blankLinesAfter: 0 }] })

  it('C2-L-056, C2-L-012: a base64 source holds the bytes, and the ranges count them', () => {
    expect(validateLayout(sidecar('base64', 'Yf9i', 3))).toBeDefined()
    expect(validateLayout(sidecar('base64', 'YeKCYg==', 4))).toBeDefined()
    expect(() => validateLayout(sidecar('base64', 'Yf9i', 4))).toThrow(CarveLayoutError)
  })

  it('C2-L-056: a base64 source is RFC 4648 base64 with padding, of bytes that are not well-formed UTF-8', () => {
    for (const source of ['a\u00ffb', 'Yf9', 'Y=9i', 'YQ', 'Yf 9i']) expect(() => validateLayout(sidecar('base64', source, 0))).toThrow(CarveLayoutError)
    expect(() => validateLayout(sidecar('base64', 'YWI=', 2))).toThrow('/encoding')
    expect(() => validateLayout(sidecar('latin1', 'ab', 2))).toThrow('/encoding')
  })
})

describe('the writer at the depth cap', () => {
  it('C2-I-118, C2-W-088: an inline footnote opener behind 200 open braced openers is text and takes no backslash (CC-025)', () => {
    const source = `${'{^'.repeat(200)}^[^"]`
    expect(checkWriter(source)).toBeNull()
    expect(format(source)).toBe(`${source}\n`)
  })

  it('C2-W-011, C2-A-171, C2-B-190: an inline footnote in a paragraph of 200 quotes is within the limits, so it is written (CC-042)', () => {
    const source = `${'> '.repeat(200)}^[^"]`
    expect(checkWriter(source)).toBeNull()
    expect(format(source)).toBe(`${source}\n`)
  })
})

describe('collapsed references', () => {
  it('C2-W-075, C2-I-079: a collapsed reference whose label breaks a line keeps the escapes its key holds', () => {
    for (const source of ['[\n\\*][]', '[a\n\\*\\_ b][]', '[ \\[x\\]\n y][]']) {
      for (const normalize of [false, true]) {
        expect(children(format(source, { normalize })), `${source} ${normalize}`).toEqual(children(source))
      }
    }
  })
})

describe('annotation ranges', () => {
  const tree = parse('\u00e9!\n\n- a\n  b', { positions: false })
  const range = (path: string, start: number, end: number) => ({ ranges: [{ id: 'r', start: { path, offset: start }, end: { path, offset: end } }] })

  it('C2-A-207, C2-A-214: an offset counts the UTF-8 bytes of the annotation text and falls between two characters', () => {
    expect(() => validateTreeWithAnnotations(tree, range('/children/0', 2, 3))).not.toThrow()
    expect(() => validateTreeWithAnnotations(tree, range('/children/0', 0, 2))).not.toThrow()
    expect(() => validateTreeWithAnnotations(tree, range('/children/0', 1, 2))).toThrow('/ranges/0/start/offset: falls inside the bytes')
    expect(() => validateTreeWithAnnotations(tree, range('/children/0', 0, 4))).toThrow('/ranges/0/end/offset')
    expect(() => validateTreeWithAnnotations(tree, range('/children/9', 0, 0))).toThrow(CarveTreeError)
  })

  it('C2-A-207: a soft break gives one line feed of the annotation text, and a block projects its children', () => {
    expect(() => validateTreeWithAnnotations(tree, range('/children/1', 0, 3))).not.toThrow()
    expect(() => validateTreeWithAnnotations(tree, range('/children/1', 0, 4))).toThrow('/ranges/0/end/offset')
    expect(() => validateTreeWithAnnotations(tree, range('', 0, 6))).not.toThrow()
  })
})

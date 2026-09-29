import { describe, expect, it } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'
import { dropPositions } from '../src/source-positions.js'
import type { Document } from '../src/ast.js'

describe('position removal traversal', () => {
  it('keeps attributes and inherited fields while stripping shared extension sidecars', () => {
    const inherited = { pos: { inherited: true }, value: { pos: { inherited: true } } }
    const shared = Object.assign(Object.create(inherited), { pos: { own: true }, termSpans: [], children: [] })
    const attrs = { pos: 'attribute value', nested: { pos: 'attribute child' } }
    Object.defineProperty(shared, 'definitionSpans', { value: [], configurable: true })
    const sidecar = { attrs: { pos: { remove: true } } }
    const doc = { sidecar, type: 'document', children: [{ type: 'extension', attrs, shared }, { type: 'extension', shared }], footnoteDefPos: {} } as unknown as Document
    shared.children.push(doc)
    dropPositions(doc)
    expect(Object.hasOwn(shared, 'pos')).toBe(false)
    expect(shared.pos).toEqual({ inherited: true })
    expect(shared.value.pos).toEqual({ inherited: true })
    expect(shared.termSpans).toBeUndefined()
    expect(Object.hasOwn(shared, 'definitionSpans')).toBe(false)
    expect(sidecar.attrs.pos).toBeUndefined()
    expect(attrs).toEqual({ pos: 'attribute value', nested: { pos: 'attribute child' } })
    expect(doc.footnoteDefPos).toBeUndefined()
  })
})

describe('definition candidate filtering', () => {
  it.each([
    'plain [literal] text\n',
    'alpha [link](/target)\n',
    '> [r]: /target\n>\n> [ref][r]\n',
    '- [r]: /target\n\n[ref][r]\n',
    '*[ABC]: expansion\n\nABC\n',
    '[r]: /target\n\n[ref][r]\n',
    '[r]:\t/invalid\n\n[ref][r]\n',
    '```\n[r]: /hidden\n```\n\n[ref][r]\n',
  ])('keeps candidate and noncandidate trees stable: %s', source => {
    const plain = parse(source)
    const forced = parse(source + '\n\n[unused]: /unused\n')
    expect(forced.children.filter(node => node.type !== 'link_reference_definition' || node.label !== 'unused')).toEqual(plain.children)
    if (source.startsWith('[r]: /target') || source.startsWith('> [r]:') || source.startsWith('- [r]:')) expect(carveToHtml(source)).toContain('href="/target"')
  })
})

it('keeps declining block matchers active beside fences on a noncandidate source', () => {
  const source = 'alpha [literal]\n~~~\nliteral\n~~~\n';
  const plain = parse(source)
  const scanned = parse(source, { extensions: [{ name: 'declines', matchBlock: () => null }] })
  expect(scanned).toEqual(plain)
})

describe('plain ASCII inline path', () => {
  it('preserves abbreviation expansion and extension matches', () => {
    expect(carveToHtml('*[ABC]: expansion\n\nABC 123\n')).toContain('<abbr title="expansion">ABC</abbr>')
    const doc = parse('alpha beta\n', { extensions: [{
      name: 'ordinary-word',
      matchInline(text, pos) {
        return text.startsWith('alpha', pos)
          ? { node: { type: 'text', value: 'changed' }, end: pos + 5 }
          : null
      },
    }] })
    expect(doc.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'changed' }, { type: 'text', value: ' beta' }] })
  })

  it('keeps punctuation, Unicode and multiline anchors on their authoritative paths', () => {
    for (const source of ['alpha -- beta', 'alpha *beta*', '😀 alpha', 'alpha\n  beta', 'alpha\t123', '| alpha  beta', '| alpha | beta |\n|---|---|\n| one | two |']) {
      const plain = parse(source)
      const scanned = parse(source, { extensions: [{ name: 'declines', matchInline: () => null }] })
      expect(plain).toEqual(scanned)
    }
  })
})

perfIt('bracket-only paragraph filtering scales linearly', () => {
  expectScansLinearly(source => void parse(source), 'alpha [literal]\n\n', {
    smallRepeats: 1250, label: 'nondefinition brackets',
  })
})

perfIt('plain ASCII inline scanning scales linearly', () => {
  expectScansLinearly(source => void parse(source), 'alpha beta ', {
    smallRepeats: 12500, suffix: '\n', label: 'ordinary inline text',
  })
})

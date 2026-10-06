import { expect, it } from 'vitest'
import { createAstPatch, applyAstPatch, mergeAst, readProvenance, fromAstJson, fromAstEnvelope } from '../src/index.js'
import type { AstJsonDocument } from '../src/ast-json.js'
import { AstStructuralIndex } from '../src/ast-structural-index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

function tree(depth: number, first = 'a', second = 'b'): AstJsonDocument {
  let node: unknown = { type: 'block_quote', children: [
    { type: 'paragraph', children: [{ type: 'text', value: first }] },
    { type: 'paragraph', children: [{ type: 'text', value: second }] },
  ] }
  for (let i = 0; i < depth; i++) node = { type: 'block_quote', children: [node] }
  return { type: 'document', srcByteLength: 0, children: [node] } as AstJsonDocument
}

it('interns metadata and JSON scalar semantics without conflating array and object values', () => {
  const index = new AstStructuralIndex()
  expect(index.key({ type: 'text', value: 'a', pos: { startLine: 1 } })).toBe(index.key({ value: 'a', type: 'text' }))
  expect(index.key({ type: 'text', attrs: { keyValues: { pos: 'a' } } })).not.toBe(index.key({ type: 'text', attrs: { keyValues: { pos: 'b' } } }))
  expect(index.key([undefined, NaN, -0])).toBe(index.key([null, null, 0]))
  expect(index.key({ a: undefined })).toBe(index.key({}))
  expect(index.key([])).not.toBe(index.key({}))
})

it('keeps deep patch paths and merges independent leaves', () => {
  const base = tree(40)
  const ours = tree(40, 'ours')
  const theirs = tree(40, 'a', 'theirs')
  const result = mergeAst(base, ours, theirs)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.ast).toEqual(tree(40, 'ours', 'theirs'))
  const patch = createAstPatch(base, ours)
  expect(patch).toHaveLength(1)
  expect(patch[0]!.path).toBe('/children/0'.repeat(42) + '/children/0/value')
  expect(applyAstPatch(base, patch)).toEqual(ours)
})

for (const operation of ['merge', 'patch']) {
  perfIt(`deep ${operation} compares each subtree once`, () => {
    expectBuiltInputScansLinearly(input => {
      const depth = (JSON.parse(input) as AstJsonDocument).children.length
      const base = tree(depth), ours = tree(depth, 'ours')
      if (operation === 'patch') createAstPatch(base, ours)
      else mergeAst(base, ours, tree(depth, 'a', 'theirs'))
    }, n => JSON.stringify({ type: 'document', children: Array.from({ length: n }, () => null) }),
    { smallRepeats: 35, largeRepeats: 140, minSampleMs: 15, label: `deep ${operation}` })
  })
}

it('preserves provenance error precedence across forward parents', () => {
  const ast = tree(0)
  expect(() => readProvenance({ version: 1, sources: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'b' }], nodes: [] }, ast)).toThrow('provenance source cycle')
  expect(() => readProvenance({ version: 1, sources: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'missing' }], nodes: [] }, ast)).toThrow('invalid provenance parent')
  const sources = [{ id: 'a', parent: 'root' }, { id: 'b', parent: 'root' }, { id: 'root' }]
  expect(readProvenance({ version: 1, sources, nodes: [] }, ast).sources).toEqual(sources)
})

for (const reverse of [false, true]) {
  perfIt(`provenance ancestry scans once (${reverse ? 'child first' : 'root first'})`, () => {
    const ast = tree(0)
    expectBuiltInputScansLinearly(input => { readProvenance(JSON.parse(input), ast) }, n => {
      const sources = Array.from({ length: n }, (_, i) => i ? { id: `s${i}`, parent: `s${i - 1}` } : { id: 's0' })
      if (reverse) sources.reverse()
      return JSON.stringify({ version: 1, sources, nodes: [] })
    }, { smallRepeats: 2_000, minSampleMs: 15, label: 'provenance ancestry' })
  })
}

function lineBlock(lines: number): AstJsonDocument {
  const children: Array<{type: string; value?: string}> = []
  const boundaries: string[] = []
  for (let i = 0; i < lines; i++) {
    children.push({type: 'text', value: 'one'})
    if (i + 1 < lines) {
      boundaries.push(`/children/${children.length}`)
      children.push({type: 'hard_break'})
    }
  }
  boundaries.push('/children/-')
  return {type: 'document', srcByteLength: 0, children: [{type: 'line_block', children: [{type: 'paragraph', children}], lines: [boundaries]}]} as AstJsonDocument
}

it('validates line-block boundaries and rejects reordered pointers', () => {
  const ast = lineBlock(3)
  expect(() => fromAstJson(ast)).not.toThrow()
  ;(ast.children[0] as {lines: string[][]}).lines[0] = ['/children/3', '/children/1', '/children/-']
  expect(() => fromAstJson(ast)).toThrow('line boundaries must name hard breaks in order')
  ;(ast.children[0] as {lines: string[][]}).lines[0] = ['/children/0', '/children/-']
  expect(() => fromAstJson(ast)).toThrow('line boundaries must name hard breaks in order')
})

perfIt('line-block boundary validation scans once', () => {
  expectBuiltInputScansLinearly(input => { fromAstJson(JSON.parse(input)) },
    n => JSON.stringify(lineBlock(n)), { smallRepeats: 4_000, minSampleMs: 15, label: 'line-block boundaries' })
})

perfIt('envelope extension membership scans once', () => {
  expectBuiltInputScansLinearly(input => {
    const extensions = JSON.parse(input) as Array<{id: string}>
    fromAstEnvelope({ astVersion: '1.0', extensions, document: tree(0) }, { extensions: extensions.map(extension => extension.id) })
  }, n => JSON.stringify(Array.from({length: n}, (_, i) => ({id: `extension${i}`}))),
  { smallRepeats: 2_000, minSampleMs: 15, label: 'envelope extensions' })
})

it('merges independent edits near the AST depth limit without exhausting the stack', () => {
  const depth = 600
  const result = mergeAst(tree(depth), tree(depth, 'ours'), tree(depth, 'a', 'theirs'))
  expect(result.ok).toBe(true)
  if (result.ok) {
    let node = result.ast.children[0] as {type: string; children: unknown[]}
    let quotes = 0
    while (node.type === 'block_quote') { quotes++; node = node.children[0] as typeof node }
    expect(quotes).toBe(depth + 1)
    expect(node).toEqual({type: 'paragraph', children: [{type: 'text', value: 'ours'}]})
    let bottom = result.ast.children[0] as {children: unknown[]}
    for (let i = 0; i < depth; i++) bottom = bottom.children[0] as typeof bottom
    expect(bottom.children[1]).toEqual({type: 'paragraph', children: [{type: 'text', value: 'theirs'}]})
  }
})

it('observes resolver mutations before comparing later siblings', () => {
  const base = tree(0), ours = tree(0, 'ours', 'o-second'), theirs = tree(0, 'theirs')
  const second = (theirs.children[0] as {children: Array<{children: Array<{value: string}>}>}).children[1]!.children[0]!
  const paths: string[] = []
  const result = mergeAst(base, ours, theirs, { resolve: conflict => {
    paths.push(conflict.path)
    second.value = 't-second'
    return 'ours'
  } })
  expect(result.ok).toBe(true)
  expect(paths).toEqual(['/children/0/children/0/children/0/value', '/children/0/children/1/children/0/value'])
  if (result.ok) expect(result.ast).toEqual(tree(0, 'ours', 'o-second'))
})

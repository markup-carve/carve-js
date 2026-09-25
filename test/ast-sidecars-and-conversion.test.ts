import { describe, expect, it } from 'vitest'
import { renderCarveWithConversionReport as collectDiagnostics } from '../src/conversion-diagnostics.js'
import {
  applyAstPatch, astNodePaths, AstPatchError, AstSidecarError, createEditorSession, parse, readAnnotationRanges, readNodeIdentity,
  parseWithProvenance, readProvenance, renderCarveWithConversionReport, toAnnotationRanges, toAstJson,
  toAuthoredProvenance, toNodeIdentity, toProvenance,
} from '../src/index.js'

const ast = () => toAstJson(parse('one\n\ntwo', { positions: true }))

describe('AST sidecars', () => {
  it('binds ephemeral identities to this AST and refuses unknown versions or paths', () => {
    const tree = ast()
    const sidecar = toNodeIdentity(tree, 'session-a')
    expect(sidecar.nodes.some((entry) => entry.path === '/children/1')).toBe(true)
    expect(readNodeIdentity(sidecar, tree)).toEqual(sidecar)
    expect(() => readNodeIdentity({ ...sidecar, version: 2 }, tree)).toThrow(AstSidecarError)
    expect(() => readNodeIdentity({ ...sidecar, nodes: [{ id: 'n', path: '/children/99' }] }, tree)).toThrow(AstSidecarError)
    expect(() => readNodeIdentity({ ...sidecar, nodes: [{ id: 'x', path: '' }, { id: 'x', path: '/children/0' }] }, tree)).toThrow(AstSidecarError)
    expect(toNodeIdentity(tree, 'session-b', new Map([['/children/0', 'n0']])).nodes.find((entry) => entry.path === '')?.id).not.toBe('n0')
  })

  it('keeps a surviving node id when a sibling is inserted ahead of it', () => {
    const session = createEditorSession('one\n\ntwo')
    const first = session.snapshot()
    const old = first.identity.nodes.find((entry) => entry.path === '/children/1')!.id
    const next = session.update([{ from: 0, to: 0, insert: 'zero\n\n' }])
    expect(next.identity.session).toBe(first.identity.session)
    expect(next.identity.nodes.find((entry) => entry.path === '/children/2')?.id).toBe(old)
    expect(next.identity.nodes.find((entry) => entry.path === '/children/0')?.id).not.toBe(old)
  })

  it('compares every edit in original coordinates when preserving node ids', () => {
    const session = createEditorSession('zero\n\nmiddle\n\ntail')
    const old = session.snapshot().identity.nodes.find((entry) => entry.path === '/children/1')!.id
    const next = session.update([
      { from: 0, to: 0, insert: '1234567890' },
      { from: 15, to: 15, insert: 'X' },
    ])
    expect(next.identity.nodes.find((entry) => entry.path === '/children/1')?.id).toBe(old)
  })

  it('checks annotation anchors in codepoints and allows overlapping ranges', () => {
    const tree = toAstJson(parse('😀abc', { positions: true }))
    const textPath = '/children/0/children/0'
    const ranges = toAnnotationRanges(tree, [
      { id: 'a', kind: 'org.example/comment', start: { path: textPath, offset: 0 }, end: { path: textPath, offset: 3 } },
      { id: 'b', kind: 'org.example/comment', start: { path: textPath, offset: 2 }, end: { path: textPath, offset: 4 } },
    ])
    expect(readAnnotationRanges(ranges, tree)).toEqual(ranges)
    expect(() => readAnnotationRanges({ ...ranges, ranges: [{ ...ranges.ranges[0], end: { path: textPath, offset: 5 } }] }, tree)).toThrow(AstSidecarError)
    expect(() => readAnnotationRanges({ ...ranges, ranges: [{ ...ranges.ranges[0], start: { path: textPath, offset: 3 }, end: { path: textPath, offset: 1 } }] }, tree)).toThrow(AstSidecarError)
    expect(() => readAnnotationRanges({ ...ranges, ranges: [{ ...ranges.ranges[0], start: { path: '/children/0', offset: 3 }, end: { path: textPath, offset: 1 } }] }, tree)).toThrow(AstSidecarError)
  })

  it('requires explicit provenance facts and checks source ancestry', () => {
    const tree = ast()
    const sidecar = toProvenance(tree, [{ id: 'root', uri: 'file:///doc.crv' }], [{ path: '/children/0', source: 'root', origin: 'authored' }])
    expect(sidecar.nodes[0]).not.toHaveProperty('startByte')
    expect(readProvenance(sidecar, tree)).toEqual(sidecar)
    expect(() => readProvenance({ ...sidecar, sources: [{ id: 'root', parent: 'root' }] }, tree)).toThrow(AstSidecarError)
    expect(() => readProvenance({ ...sidecar, nodes: [{ path: '/children/0', source: 'missing', origin: 'authored' }] }, tree)).toThrow(AstSidecarError)
    expect(() => readProvenance({ ...sidecar, nodes: [{ path: '/children/0', source: 'root', origin: 'authored', startByte: 3 }] }, tree)).toThrow(AstSidecarError)
    expect(() => readProvenance({ ...sidecar, nodes: [{ path: '/children/0', source: 'root', origin: 'authored', startByte: 4, endByte: 3 }] }, tree)).toThrow(AstSidecarError)
  })

  it('measures authored top-level source bytes without guessing nested provenance', () => {
    const source = '😀 one\n\ntwo'
    const { ast: tree, provenance: sidecar } = parseWithProvenance(source, 'file:///doc.crv')
    expect(sidecar).toEqual(toAuthoredProvenance(tree, source, 'file:///doc.crv'))
    expect(sidecar.sources).toEqual([{ id: 's0', uri: 'file:///doc.crv' }])
    expect(sidecar.nodes[0]).toMatchObject({ path: '/children/0', startByte: 0, endByte: expect.any(Number) })
    expect(sidecar.nodes.every((entry) => /^\/children\/\d+$/.test(entry.path))).toBe(true)
  })

  it('does not treat an extension payload object as an AST node', () => {
    const tree = { type: 'document', srcByteLength: 0, children: [{ type: 'block_extension', name: 'org.example.diagram', fallback: { type: 'paragraph', children: [] }, payload: { format: 'application/json', value: { type: 'fake' } } }] } as never
    expect(astNodePaths(tree)).toEqual(['', '/children/0', '/children/0/fallback'])
    expect(() => readNodeIdentity({ version: 1, session: 's', nodes: [{ id: 'x', path: '/children/0/payload/value' }] }, tree)).toThrow(AstSidecarError)
  })
})

describe('Carve conversion diagnostics', () => {
  it('reports each unspellable field separately and supports truncation', () => {
    const tree = parse('x')
    tree.children = [{ type: 'paragraph', children: [{ type: 'math', content: 'x', display: false, label: 'eq', number: 1 }] }] as typeof tree.children
    const result = renderCarveWithConversionReport(tree, {}, 1)
    expect(result.value).toBeDefined()
    expect(result.report).toMatchObject({ totalDiagnostics: 2, truncated: true })
    expect(result.report.diagnostics).toMatchObject([{ code: 'field-unspellable', node: 'math' }])
    expect(renderCarveWithConversionReport(tree, {}, 0).report).toMatchObject({ totalDiagnostics: 2, diagnostics: [], truncated: true })
  })

  it('reports a typed writer refusal without swallowing unrelated errors', () => {
    const tree = parse('x')
    tree.children = [{ type: 'paragraph', children: [{ type: 'raw_inline', format: 'html', content: '' }] }] as typeof tree.children
    const result = renderCarveWithConversionReport(tree)
    expect(result.value).toBeUndefined()
    expect(result.report.diagnostics).toMatchObject([{ code: 'structure-unspellable', node: 'raw_inline' }])
  })

  it('names short captions, table figures, single-line breaks, and paragraphs lost on write', () => {
    const tree = parse('x')
    tree.children = [
      { type: 'figure', target: { type: 'table', columns: [], rows: [] }, caption: [], shortCaption: [] },
      { type: 'paragraph', children: [{ type: 'image', src: 'u', alt: 'a' }] },
      { type: 'paragraph', children: [{ type: 'comment', content: 'c', block: false }] },
      { type: 'table', columns: [], rows: [{ type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [{ type: 'text', value: 'x' }, { type: 'hard_break' }, { type: 'text', value: 'y' }] }] }], shortCaption: [] },
    ] as typeof tree.children
    const result = collectDiagnostics(tree, () => '')
    expect(result.report.diagnostics.map(({ code, node, field }) => [code, node, field])).toEqual([
      ['field-unspellable', 'figure', 'shortCaption'],
      ['structure-unspellable', 'figure', undefined],
      ['structure-unspellable', 'paragraph', undefined],
      ['structure-unspellable', 'paragraph', undefined],
      ['field-unspellable', 'table', 'shortCaption'],
      ['structure-unspellable', 'hard_break', undefined],
    ])
  })
})

it('rejects a malformed patch operation before applying any operation', () => {
  const tree = ast()
  const original = structuredClone(tree)
  expect(() => applyAstPatch(tree, [
    { op: 'remove', path: '/children/0' },
    { op: 'move', path: '/children/0', value: {} },
  ] as never)).toThrow(AstPatchError)
  expect(tree).toEqual(original)
  expect(() => applyAstPatch(tree, [{ op: 'add', path: '/children/0' }] as never)).toThrow(AstPatchError)
  expect(() => applyAstPatch(tree, [{ op: 'remove', path: '/children/~2' }] as never)).toThrow(AstPatchError)
})

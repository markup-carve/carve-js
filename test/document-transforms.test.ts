import { describe, expect, it } from 'vitest'
import { CarveRenderError, parse, render, renderWithDiagnostics, renderWithDocumentTransforms, tabsExtensions, tabsRenderer } from '../src/index.ts'
import { type ExtensionDefinition } from '../src/extensions/types.ts'

describe('C2-X-053 to C2-X-055: document transforms', () => {
  it('skips an inapplicable transform and still runs a later applicable one', () => {
    let skipped = 0
    const result = renderWithDocumentTransforms('hello', [
      { name: 'absent', appliesTo: () => false, transform: (view) => { skipped++; return view } },
      { name: 'present', appliesTo: () => true, transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph') paragraph.children.push({ type: 'text', value: '!' })
        return view
      } },
    ])
    expect(skipped).toBe(0)
    expect(result.html).toBe('<p>hello!</p>')
  })

  it('runs transforms in order on a copy of the resolved view', () => {
    const authored = parse('hello')
    const result = renderWithDocumentTransforms(authored, [
      { name: 'first', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'text') {
          paragraph.children[0].value += '?'
        }
        return view
      } },
      { name: 'second', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'text') {
          paragraph.children[0].value += '!'
        }
        return view
      } },
    ])
    expect(result.html).toBe('<p>hello?!</p>')
    expect(render(authored)).toBe('<p>hello</p>')
    expect(result.diagnostics).toEqual([])
  })

  it('keeps the prior view when a transform creates duplicate authored ids', () => {
    const result = renderWithDocumentTransforms('[a]{#first} [b]{#second}', [
      { name: 'first', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[0]?.type === 'span' &&
          paragraph.children[0].children[0]?.type === 'text') paragraph.children[0].children[0].value = 'X'
        return view
      } },
      { name: 'duplicate', transform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph' && paragraph.children[2]?.type === 'span' &&
          paragraph.children[2].attrs !== undefined) paragraph.children[2].attrs.id = 'first'
        return view
      } },
    ])
    expect(result.html).toBe('<p><span id="first">X</span> <span id="second">b</span></p>')
    expect(result.diagnostics.some((entry) => entry.code === 'extension-transform-failed' &&
      entry.message.includes('duplicate'))).toBe(true)
  })

  it('keeps source diagnostics when the render view is transformed', () => {
    const source = '{{ a.crv }}'
    const baseline = renderWithDiagnostics(source)
    const transformed = renderWithDocumentTransforms(source, [{ name: 'identity', transform: (view) => view }])
    expect(baseline.diagnostics.length).toBeGreaterThan(0)
    expect(transformed.diagnostics).toEqual(baseline.diagnostics)
  })

  it('reports a source diagnostic once when the transformed view resolves again', () => {
    const source = '[a]{#x} [b]{#x}'
    const baseline = renderWithDiagnostics(source)
    const transformed = renderWithDocumentTransforms(source, [])
    expect(baseline.diagnostics.filter((entry) => entry.code === 'duplicate-id')).toHaveLength(1)
    expect(transformed.diagnostics).toEqual(baseline.diagnostics)
  })

  it('treats a failed transform as a strict render loss', () => {
    const result = renderWithDocumentTransforms('hello', [
      { name: 'broken', transform: () => { throw new Error('broken') } },
    ], { strictLosses: true })
    expect(result.html).toBe('')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'extension-transform-failed', severity: 'error', channel: 'render-loss',
    }))
  })

  it('rejects an extension prop that its registered schema does not declare', () => {
    const source = ':::: tabs\n::: tab "A"\nbody\n:::\n::::\n'
    const options = { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } }
    const result = renderWithDocumentTransforms(source, [
      { name: 'invalid', transform: (view) => {
        const tabs = view.children[0]
        if (tabs?.type === 'block_extension') tabs.props = { bogus: 'x' }
        return view
      } },
    ], options)
    expect(result.html).toBe(render(source, options))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension-transform-failed' }))
  })

  it('does not fail a transform over a duplicate id the source already holds', () => {
    const result = renderWithDocumentTransforms('[a]{#x} [b]{#x}', [{ name: 'mark', transform: (view) => {
      const paragraph = view.children[0]
      if (paragraph?.type === 'paragraph') paragraph.children.push({ type: 'text', value: '!' })
      return view
    } }])
    expect(result.html).toBe('<p><span id="x">a</span> <span id="x">b</span>!</p>')
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('extension-transform-failed')
  })

  it('fails a transform that adds an occurrence of an id the source already duplicates', () => {
    const result = renderWithDocumentTransforms('[a]{#x} [b]{#x}', [{ name: 'third', transform: (view) => {
      const paragraph = view.children[0]
      if (paragraph?.type === 'paragraph') paragraph.children.push({ type: 'span', attrs: { id: 'x' }, children: [] })
      return view
    } }])
    expect(result.html).toBe('<p><span id="x">a</span> <span id="x">b</span></p>')
    expect(result.diagnostics.map((entry) => entry.message)).toContain('The document transform third failed: duplicate authored id x')
  })

  it('runs the document transforms registered in extensions, in registration order', () => {
    const suffix = (name: string, text: string): ExtensionDefinition => ({ name, version: '1', props: {}, slots: {},
      documentTransform: (view) => {
        const paragraph = view.children[0]
        if (paragraph?.type === 'paragraph') paragraph.children.push({ type: 'text', value: text })
        return view
      } })
    const options = { extensions: [suffix('host.first', '1'), suffix('host.second', '2')] }
    expect(render('a', options)).toBe('<p>a12</p>')
    expect(renderWithDiagnostics('a', options).html).toBe('<p>a12</p>')
    expect(renderWithDocumentTransforms('a', [{ name: 'third', transform: (view) => view }], options).html).toBe('<p>a12</p>')
    const failing: ExtensionDefinition = { name: 'host.broken', version: '1', props: {}, slots: {},
      documentTransform: () => { throw new Error('boom') } }
    const result = renderWithDiagnostics('a', { extensions: [failing] })
    expect(result.html).toBe('<p>a</p>')
    expect(result.diagnostics[0]?.message).toBe('The document transform host.broken failed: boom')
    expect(() => render('a', { extensions: [failing], strictLosses: true })).toThrow(CarveRenderError)
  })
})

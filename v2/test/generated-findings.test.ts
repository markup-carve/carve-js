import { describe, expect, it } from 'vitest'
import { type ExtensionDefinition, parse, parseWithDiagnostics, render, renderWithDiagnostics,
  tabExtension, tabsExtension, tabsRenderer, validateTree } from '../src/index.ts'

const failureExtension: ExtensionDefinition = {
  name: 'test.failure', version: '1', matcher: { form: 'div', name: 'failure' }, props: {}, slots: {},
  transform: (claim) => claim.form === 'div' ? {
    type: 'block_extension', name: 'test.failure', version: '1', children: [], fallback: claim.body,
  } : null,
}

describe('generated parser findings', () => {
  it('C2-A-143, C2-B-165: a leading byte order mark takes no column', () => {
    const source = '\ufeffP'
    const document = parse(source)
    expect(document.children[0]?.pos?.startColumn).toBe(1)
    expect(() => validateTree(document, undefined, source)).not.toThrow()
  })

  it('C2-A-093, C2-B-173: a row span continues from the body into the footer', () => {
    const source = '{footer-rows}\n||\n|^|\n|^|\n'
    expect(() => validateTree(parse(source), undefined, source)).not.toThrow()
  })

  it('C2-A-138, C2-A-156: a literal fence title has a position', () => {
    const source = '```python "src/app.py"\ncode\n```'
    const document = parse(source)
    const block = document.children[0]
    expect(block?.type).toBe('code_block')
    if (block?.type !== 'code_block') return
    expect(block.title?.[0]?.pos?.startOffset).toBe(source.indexOf('src/app.py'))
    expect(() => validateTree(document, undefined, source)).not.toThrow()
    const escaped = parse('```python "a\\"b"\ncode\n```').children[0]
    if (escaped?.type !== 'code_block') return
    expect(escaped.title?.[0]?.pos).toBeUndefined()
  })

  it('C2-H-176: text that HTML cannot carry literally is replaced', () => {
    for (const character of ['\u001d', '\ufdd5', '\ud800', '\u0000', '\u007f', '\ud83f\udffe']) {
      expect(render(character)).toBe('<p>\ufffd</p>')
    }
    expect(render('👍🏾 👍🏿')).toBe('<p>👍🏾 👍🏿</p>')
    expect(render('{title="\u001d"}\na')).toBe('<p title="\ufffd">a</p>')
  })

  it('C2-H-176, C2-X-043: tab content uses the same HTML text rule', () => {
    const source = ':::: tabs\n::: tab "One"\n\u001d\n:::\n::::\n'
    const html = render(source, { extensions: [tabExtension, tabsExtension], renderers: { 'carve.tabs': tabsRenderer } })
    expect(html).toContain('<p>\ufffd</p>')
  })

  it('C2-X-034: a throwing renderer writes the fallback and names the extension', () => {
    const rendered = renderWithDiagnostics('::: failure\nBody\n:::', {
      extensions: [failureExtension], renderers: { 'test.failure': { version: '1', render: () => {
        throw new Error('test failure')
      } } },
    })
    expect(rendered.html).toContain('<p>Body</p>')
    expect(rendered.diagnostics.some((entry) => entry.message.includes('test.failure'))).toBe(true)
  })

  it('C2-X-034: a renderer result that is not a string writes the fallback', () => {
    const renderer = { version: '1', render: () => '<b>ok</b>' }
    Reflect.set(renderer, 'render', () => 42)
    const rendered = renderWithDiagnostics('::: failure\nBody\n:::', {
      extensions: [failureExtension], renderers: { 'test.failure': renderer },
    })
    expect(rendered.html).toContain('<p>Body</p>')
    expect(rendered.diagnostics.some((entry) => entry.message.includes('test.failure'))).toBe(true)
  })

  it('C2-X-034: a throwing transform retains the core node and reports its name', () => {
    const definition: ExtensionDefinition = { ...failureExtension, transform: () => { throw new Error('test failure') } }
    const parsed = parseWithDiagnostics('::: failure\nBody\n:::', { extensions: [definition] })
    expect(parsed.document.children[0]?.type).toBe('div')
    expect(parsed.diagnostics.some((entry) => entry.message.includes('test.failure'))).toBe(true)
  })

  it('C2-X-050: a renderer helper failure keeps earlier and later output', () => {
    const rendered = renderWithDiagnostics('before\n\n::: failure\nBody\n:::\n\nafter', {
      extensions: [failureExtension], renderers: { 'test.failure': { version: '1', render: (_node, host) => {
        const malformed = { type: 'paragraph' as const, children: [] }
        Reflect.deleteProperty(malformed, 'children')
        return host.blocks([malformed])
      } } },
    })
    expect(rendered.html).toBe('<p>before</p>\n<p>Body</p>\n<p>after</p>')
    expect(rendered.diagnostics.some((entry) => entry.code === 'extension-renderer-failed')).toBe(true)
  })

  it('C2-X-050: a failed renderer does not duplicate findings from its partial output', () => {
    const rendered = renderWithDiagnostics('::: failure\n[bad](javascript:alert)\n:::', {
      extensions: [failureExtension], renderers: { 'test.failure': { version: '1', render: (node, host) => {
        if (node.type === 'block_extension') host.blocks(node.fallback)
        host.nextId('tabs')
        throw new Error('test failure')
      } } },
    })
    expect(rendered.diagnostics.filter((entry) => entry.code === 'destination-denied')).toHaveLength(1)
  })
})

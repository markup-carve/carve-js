import { describe, expect, it } from 'vitest'
import { parseTree, parseWithDiagnostics, render, renderWithDiagnostics, treesEqual, validateTree, write } from '../../src/index.ts'
import { migrationExtensions, migrationRenderers } from '../../extensions/index.ts'

const color = ':color[#f00]'
const table = '::: list-table\n- - A\n  - B\n:::'
const image = '```img\n<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n```'
const options = { extensions: migrationExtensions, renderers: migrationRenderers, urlPolicy: { allow: ['data'] } }

describe('migration registration contracts', () => {
  it.each([color, table, image])('writes and parses the same qualified tree for %s', (source) => {
    const first = parseTree(source, { extensions: migrationExtensions }).document
    const written = write(first, { extensions: migrationExtensions })
    const second = parseTree(written, { extensions: migrationExtensions }).document
    expect(treesEqual(first, second)).toBe(true)
  })

  it.each([color, table, image])('keeps a canonical source record and a core fallback for %s', (source) => {
    const document = parseTree(source, { extensions: migrationExtensions }).document
    const root = document.children[0]
    const extension = root?.type === 'paragraph' ? root.children[0] : root
    expect(extension?.type === 'inline_extension' || extension?.type === 'block_extension').toBe(true)
    if (extension?.type !== 'inline_extension' && extension?.type !== 'block_extension') return
    expect(extension.name).toMatch(/^carve\./)
    expect(extension.version).toBe('1')
    expect(extension.source?.body).toBeDefined()
    expect(extension.fallback?.length).toBeGreaterThan(0)
  })

  it('carries the table rows and caption in declared slots', () => {
    const source = '::: list-table "Caption"\n- - A\n  - B\n:::'
    const extension = parseTree(source, { extensions: migrationExtensions }).document.children[0]
    if (extension?.type !== 'block_extension') throw new Error('Table claim failed')
    expect(extension.slots?.['rows']?.[0]?.type).toBe('list')
    expect(extension.slots?.['caption']?.[0]?.type).toBe('text')
  })

  it('carries an image language and source payload', () => {
    const extension = parseTree(image, { extensions: migrationExtensions }).document.children[0]
    if (extension?.type !== 'block_extension') throw new Error('Image claim failed')
    expect(extension.props?.['language']).toBe('img')
    expect(extension.payload?.[0]?.format).toBe('image/svg+xml')
    expect(extension.payload?.[0]?.value).toContain('<svg')
  })

  it('renders a core form when unregistered', () => {
    expect(render(':color[red]')).toBe('<p><span class="ext-color">red</span></p>')
    expect(render(table)).toContain('<div class="list-table">')
    expect(render(image)).toContain('<pre><code class="language-img">')
  })

  it('uses the declared fallback when a renderer is absent', () => {
    expect(render(color, { extensions: migrationExtensions })).toContain('<span class="tag"><strong>#f00</strong></span>')
    expect(render(table, { extensions: migrationExtensions })).toContain('<ul>')
    expect(render(image, { extensions: migrationExtensions })).toContain('&lt;svg')
  })

  it.each(['full', 'article', 'comment', 'minimal'] as const)('renders color in the %s profile', (profile) => {
    expect(render(color, { ...options, profile })).toContain('class="swatch"')
  })

  it.each(['full', 'article'] as const)('renders the table and image in the %s profile', (profile) => {
    expect(render(table, { ...options, profile })).toContain('<table>')
    expect(render(image, { ...options, profile })).toContain('<img src="data:image/svg+xml,')
  })

  it.each(['comment', 'minimal'] as const)('degrades the table and image in the %s profile', (profile) => {
    expect(render(table, { ...options, profile })).toBe('<p>- - A - B</p>')
    expect(render(image, { ...options, profile })).toContain('&lt;svg')
  })

  it('obeys the default URL policy for a generated image URL', () => {
    expect(render(image, { extensions: migrationExtensions, renderers: migrationRenderers })).toContain('<pre><code')
  })

  it('blanks denied authored URL and CSS values on a swatch', () => {
    const deniedUrl = ':color[red]{href=javascript:alert(1)}'
    const deniedStyle = ':color[red]{style="background:u\\72l(x)"}'
    expect(render(deniedUrl, options)).toContain('href=""')
    expect(render(deniedStyle, options)).toContain('style=""')
    expect(render(deniedUrl, options)).not.toContain('javascript:')
  })

  it('keeps a prototype-named author attribute on an image without changing the data URI', () => {
    const source = '{__proto__=x alt=map}\n```img\n<svg/>\n```'
    const html = render(source, options)
    expect(html).toContain('__proto__="x"')
    expect(html).toContain('alt="map"')
    expect(html).toContain('src="data:image/svg+xml,')
  })

  it('retains invalid color and malformed table source without an extension diagnostic', () => {
    const invalidColor = parseWithDiagnostics(':color[banana]', { extensions: migrationExtensions })
    const invalidTable = parseWithDiagnostics('::: list-table\nnot a list\n:::', { extensions: migrationExtensions })
    expect(invalidColor.document.children[0]?.type).toBe('paragraph')
    expect(invalidTable.document.children[0]?.type).toBe('div')
    expect(invalidColor.diagnostics.filter((entry) => entry.code.startsWith('extension-'))).toEqual([])
    expect(invalidTable.diagnostics.filter((entry) => entry.code.startsWith('extension-'))).toEqual([])
  })

  it('renders a non SVG image fence as escaped code without a renderer exception', () => {
    const result = renderWithDiagnostics('```img\nnot <svg>\n```', options)
    expect(result.html).toContain('&lt;svg&gt;')
    expect(result.diagnostics.filter((entry) => entry.code.startsWith('extension-'))).toEqual([])
  })

  it.each([color, table, image])('refuses an extension source body beyond 8 MiB for %s', (source) => {
    const document = parseTree(source, { extensions: migrationExtensions }).document
    const root = document.children[0]
    const extension = root?.type === 'paragraph' ? root.children[0] : root
    if (extension?.type !== 'inline_extension' && extension?.type !== 'block_extension') throw new Error('Claim failed')
    if (extension.source === undefined) throw new Error('Source record missing')
    extension.source.body = 'x'.repeat(8 * 1024 * 1024 + 1)
    expect(() => validateTree(document, undefined, undefined, migrationExtensions)).toThrow()
  })

  it('refuses an image payload beyond 8 MiB', () => {
    const document = parseTree(image, { extensions: migrationExtensions }).document
    const extension = document.children[0]
    if (extension?.type !== 'block_extension') throw new Error('Image claim failed')
    extension.payload = [{ format: 'image/svg+xml', value: 'x'.repeat(8 * 1024 * 1024 + 1) }]
    expect(() => validateTree(document, undefined, undefined, migrationExtensions)).toThrow()
  })
})

describe('hostile image fences', () => {
  it.each([
    ['script', '<script>alert(1)</script><rect width="1" height="1"/>', 'script'],
    ['handler', '<rect onload="alert(1)" width="1" height="1"/>', 'onload'],
    ['external reference', '<use href="https://attacker.example/a.svg#x"/>', 'attacker.example'],
    ['javascript URL', '<use href="javascript:alert(1)"/>', 'javascript:'],
    ['data URL', '<image href="data:image/svg+xml,%3Csvg%2F%3E"/>', 'href="data:'],
  ])('removes the %s payload before the image URL is encoded', (_name, body, needle) => {
    const source = `\`\`\`img\n<svg>${body}</svg>\n\`\`\``
    const html = render(source, options)
    expect(html).toContain('<img src="data:image/svg+xml,')
    expect(decodeURIComponent(html)).not.toContain(needle)
  })
})

import { afterEach, expect, it, vi } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import * as ids from '../src/document-ids.js'

afterEach(() => vi.restoreAllMocks())

it('ordinary public renders do not collect an unused id namespace', () => {
  const collect = vi.spyOn(ids, 'collectDocumentIds')
  const doc = parse('> text\n')
  expect(renderHtml(doc)).toBe('<blockquote><p>text</p></blockquote>')
  expect(collect).not.toHaveBeenCalled()
  renderHtml(parse('::: note \"Title\"\nbody\n:::\n'))
  expect(collect).toHaveBeenCalledOnce()
})

it('generated ids reserve authored ids later in the document on every render', () => {
  const doc = parse('::: note "Title"\nBody\n:::\n\n{#adm-1}\nReserved\n')
  expect(renderHtml(doc)).toContain('aria-labelledby="adm-1-2"')
  doc.children.at(-1)!.attrs!.id = 'adm-1-2'
  expect(renderHtml(doc)).toContain('aria-labelledby="adm-1"')
})

it('callback rendering keeps the entry namespace when the caller mutates the AST', () => {
  const doc = parse('``` =other\ndropped\n```\n\n::: note "Title"\nBody\n:::\n\n{#adm-1}\nReserved\n')
  const html = renderHtml(doc, {
    onRenderLoss: () => { doc.children.at(-1)!.attrs!.id = 'changed' },
  })
  expect(html).toContain('aria-labelledby="adm-1-2"')
})

it('recursive callback rendering restores the outer namespace', () => {
  const doc = parse('``` =other\ndropped\n```\n\n::: note "Title"\nBody\n:::\n\n{#adm-1}\nReserved\n')
  const html = renderHtml(doc, { onRenderLoss: () => renderHtml(parse('Inner')) })
  expect(html).toContain('aria-labelledby="adm-1-2"')
})

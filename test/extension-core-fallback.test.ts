import { describe, expect, it } from 'vitest'
import { detailsExtension, parse, renderWithDiagnostics, standardTabsRenderer, tabsExtensions,
  validateTree } from '../src/index.ts'
import { type ExtensionDefinition, type ExtensionRenderer } from '../src/extensions/types.ts'
import { details } from '../extensions/blocks/details.ts'
import { listTable } from '../extensions/blocks/list-table.ts'
import { spoiler } from '../extensions/blocks/spoiler.ts'
import { wikilinks } from '../extensions/inline/wikilinks.ts'

// carve-js#5775: a claimed body that holds an inline extension is claimed, and its fallback holds core content only.
interface Shape { input: string, extensions: readonly ExtensionDefinition[], renderers?: Record<string, ExtensionRenderer>, html: string }

const disclosure = details()
const hidden = spoiler()
const table = listTable()
const wiki = wikilinks()
const shapes: Record<string, Shape> = {
  details: { input: '::: details "X"\nY :wiki[Z].\n:::\n', extensions: [...disclosure.extensions, ...wiki.extensions],
    renderers: { ...disclosure.renderers, ...wiki.renderers },
    html: '<details>\n  <summary>X</summary>\n  <p>Y <a href="z" class="wikilink" data-wikilink="Z">Z</a>.</p>\n</details>' },
  tabs: { input: ':::: tabs\n::: tab "A"\nY :foo[Z].\n:::\n::::\n', extensions: tabsExtensions,
    renderers: { 'carve.tabs': standardTabsRenderer() },
    html: '<div class="tabs" role="group" aria-label="Tabs"><input type="radio" name="tabs-1" id="tabs-1-0" checked>' +
      '<label for="tabs-1-0">A</label><div class="tab-panel" role="group" aria-label="A">' +
      '<p>Y <span class="ext-foo">Z</span>.</p></div></div>' },
  spoiler: { input: '::: spoiler\nY :foo[Z].\n:::\n', extensions: hidden.extensions,
    renderers: hidden.renderers ?? {},
    html: '<details class="spoiler">\n  <summary>Spoiler</summary>\n  <p>Y <span class="ext-foo">Z</span>.</p>\n</details>' },
  'list-table': { input: '::: list-table\n- - a :foo[Z]\n  - b\n:::\n', extensions: table.extensions,
    renderers: table.renderers ?? {},
    html: '<table>\n  <tbody>\n    <tr><td>a <span class="ext-foo">Z</span></td><td>b</td></tr>\n  </tbody>\n</table>' },
}

describe('a block extension whose body holds an inline extension', () => {
  for (const [name, shape] of Object.entries(shapes)) {
    it(`claims the ${name} block without a diagnostic`, () => {
      const result = renderWithDiagnostics(shape.input, { extensions: shape.extensions, renderers: shape.renderers ?? {} })
      expect(result.diagnostics).toEqual([])
      expect(result.html).toBe(shape.html)
    })
  }

  it('gives an unqualified inline extension in the fallback as its core span', () => {
    const extensions = [detailsExtension]
    const document = parse('::: details "X"\nY :foo[Z]{#i .c}.\n:::\n', { extensions, positions: false })
    const node = document.children[0]
    expect(node?.type).toBe('block_extension')
    if (node?.type !== 'block_extension') return
    expect(node.fallback[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: 'Y ' },
      { type: 'span', attrs: { id: 'i', classes: ['ext-foo', 'c'] }, children: [{ type: 'text', value: 'Z' }] },
      { type: 'text', value: '.' }] })
    expect(node.slots?.['body']?.[0]).toMatchObject({ children: [{}, { type: 'inline_extension', name: 'foo' }, {}] })
    expect(() => validateTree(document, undefined, undefined, extensions)).not.toThrow()
  })
})

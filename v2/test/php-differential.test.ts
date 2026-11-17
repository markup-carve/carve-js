// Defects the PHP engine's differential found in this engine, each named by the clause it breaks.
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parseWithLayout, tabsExtensions, writeWithDiagnostics, type DocumentNode } from '../src/index.ts'

describe('the PHP differential', () => {
  it('C2-X-026, C2-W-089, C2-L-010: a tab body that uses a definition outside it is claimed, and the layout names its slots', () => {
    const source = ':::: tabs\n::: tab "A"\n# Head\n\nBody [x].\n:::\n::::\n\n[x]: /u\n'
    const result = parseWithLayout(source, { extensions: tabsExtensions })
    const tabs = result.document.children[0]
    expect(tabs?.type).toBe('block_extension')
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain('extension-transform-failed')
    const tab = tabs?.type === 'block_extension' ? tabs.slots?.['tabs']?.[0] : undefined
    expect(tab?.type === 'block_extension' ? tab.source?.body : undefined).toBe('= Head\n\nBody [x].\n')
    expect(result.layout.nodes.map((entry) => entry.path)).toContain('/children/0/slots/tabs/0/slots/body/1')
  })

  it('C2-W-125 case five: the caret that starts span text gets its backslash', () => {
    for (const source of ['x [\\^a]{.c}', '[\\^a b]{#i}']) {
      const result = formatWithDiagnostics(source)
      expect(result.source, source).toBe(`${source}\n`)
      expect(result.diagnostics, source).toEqual([])
    }
  })

  it('C2-W-011, C2-M-074: a document lang or dir, which no source spells, is reported', () => {
    const document: DocumentNode = { type: 'document', astVersion: '2.0', lang: 'de', dir: 'rtl',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hallo' }] }] }
    const result = writeWithDiagnostics(document)
    expect(result.source).toBe('Hallo\n')
    expect(result.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`))
      .toEqual(['field-unspellable /lang', 'field-unspellable /dir'])
  })
})

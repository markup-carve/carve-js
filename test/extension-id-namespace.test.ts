import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'
import { citations } from '../src/citations.js'
import { codeGroup } from '../src/code-group.js'
import { tabs } from '../src/tabs.js'
import { DocumentIdRegistry } from '../src/document-ids.js'

// Extension-generated ids join the document id namespace (extensions contract
// §2.6; markup-carve/carve#238): explicit {#id} attributes and generated
// heading ids reserve names FIRST, and generated tabset-/codegroup-/cite- ids
// take the next free suffix instead of colliding. Scenarios mirror
// carve-php#287's test set for cross-implementation parity.

describe('DocumentIdRegistry', () => {
  it('returns the base when free and 1-based suffixes on collision', () => {
    const r = new DocumentIdRegistry()
    expect(r.uniqueId('tabset-1')).toBe('tabset-1')
    expect(r.uniqueId('tabset-1')).toBe('tabset-1-2')
    expect(r.uniqueId('tabset-1')).toBe('tabset-1-3')
  })

  it('skips suffix candidates that are already reserved', () => {
    const r = new DocumentIdRegistry()
    r.reserve('x-2')
    r.reserve('x-3')
    expect(r.uniqueId('x')).toBe('x')
    expect(r.uniqueId('x')).toBe('x-4')
  })
})

describe('tabs ids join the document id namespace', () => {
  const src = ':::: tabs\n::: tab\n### First\n\nContent.\n:::\n::::'

  it('generated css ids avoid an explicit {#tabset-1}', () => {
    const html = carveToHtml(`{#tabset-1}\nReserved.\n\n${src}`, {
      extensions: [tabs()],
    })
    expect(html).toContain('name="tabset-1-2"')
    expect(html).toContain('id="tabset-1-2-tab-1"')
    expect(html).toContain('for="tabset-1-2-tab-1"')
  })

  it('generated aria ids avoid explicit ids and keep tab/panel pairs aligned', () => {
    const html = carveToHtml(`{#tabset-1}\nReserved.\n\n${src}`, {
      extensions: [tabs({ mode: 'aria' })],
    })
    expect(html).toContain(
      'id="tabset-1-2-tab-1" aria-selected="true" aria-controls="tabset-1-2-panel-1"',
    )
    expect(html).toContain('id="tabset-1-2-panel-1" aria-labelledby="tabset-1-2-tab-1"')
  })

  it('a colliding heading auto-slug also bumps the generated id', () => {
    const html = carveToHtml(`# tabset 1\n\n${src}`, { extensions: [tabs()] })
    expect(html).toContain('<section id="tabset-1">')
    expect(html).toContain('name="tabset-1-2"')
  })

  it('ids without collisions are unchanged', () => {
    const html = carveToHtml(src, { extensions: [tabs()] })
    expect(html).toContain('name="tabset-1"')
    expect(html).toContain('id="tabset-1-tab-1"')
  })
})

describe('code-group ids join the document id namespace', () => {
  const src = '::: code-group\n``` php\necho 1;\n```\n\n``` js\nlet x\n```\n:::'

  it('generated ids avoid an explicit {#codegroup-1}', () => {
    const html = carveToHtml(`{#codegroup-1}\nReserved.\n\n${src}`, {
      extensions: [codeGroup()],
    })
    expect(html).toContain('name="codegroup-1-2"')
    expect(html).toContain('id="codegroup-1-2-tab-1"')
    expect(html).toContain('for="codegroup-1-2-tab-1"')
  })

  it('ids without collisions are unchanged', () => {
    const html = carveToHtml(src, { extensions: [codeGroup()] })
    expect(html).toContain('name="codegroup-1"')
    expect(html).toContain('id="codegroup-1-tab-1"')
  })
})

describe('citation ids join the document id namespace', () => {
  const bib = [{ id: 'foo', title: 'Foo' }]
  const render = (src: string) =>
    carveToHtml(src, { extensions: [citations({ bibliography: bib })] })

  it('no-collision ids remain stable', () => {
    const html = render('See [@foo].')
    expect(html).toContain('id="cite-foo-1"')
    expect(html).toContain('href="#ref-foo"')
    expect(html).toContain('<li id="ref-foo">')
    expect(html).toContain('href="#cite-foo-1"')
  })

  it('citation anchor ids avoid heading ids and back-refs follow', () => {
    const html = render('# cite foo 1\n\nSee [@foo].')
    expect(html).toContain('<section id="cite-foo-1">')
    expect(html).toContain('id="cite-foo-1-2"')
    expect(html).toContain('href="#cite-foo-1-2"')
  })

  it('reference ids avoid explicit ids and citations follow', () => {
    const html = render('{#ref-foo}\nReserved.\n\nSee [@foo].')
    expect(html).toContain('href="#ref-foo-2"')
    expect(html).toContain('<li id="ref-foo-2">')
  })
})

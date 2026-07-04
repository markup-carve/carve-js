import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'
import { tocPlacement } from '../src/table-of-contents.js'

const h = (s: string) => carveToHtml(s, { extensions: [tocPlacement()] }).trim()

describe('::: toc placement directive', () => {
  it('renders a nested nav where the directive is written', () => {
    const out = h('# Intro\n\n::: toc\n:::\n\n## Setup\n\n### Details\n\n## Usage\n')
    expect(out).toContain(
      '<nav class="toc">\n<ul>\n<li><a href="#Intro">Intro</a>\n<ul>\n' +
        '<li><a href="#Setup">Setup</a>\n<ul>\n<li><a href="#Details">Details</a></li>\n</ul>\n</li>\n' +
        '<li><a href="#Usage">Usage</a></li>\n</ul>\n</li>\n</ul>\n</nav>',
    )
    // The nav sits inline, before the following sections (not at doc top/bottom).
    expect(out.indexOf('<nav')).toBeLessThan(out.indexOf('<h2>Setup'))
  })

  it('links to resolved, dedup-aware heading ids', () => {
    const out = h('# Intro\n\n## Intro\n\n::: toc\n:::\n')
    // The second "Intro" is deduped by the core; the toc must link the SAME
    // resolved ids the <h*> anchors use, whatever the dedup suffix is.
    const ids = [...out.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(out).toContain(`<a href="#${id}">Intro</a>`)
  })

  it('{depth=N} limits to levels 1..N', () => {
    const out = h('# A\n\n{depth=2}\n::: toc\n:::\n\n## B\n\n### C\n\n## D\n')
    expect(out).toContain(
      '<nav class="toc">\n<ul>\n<li><a href="#A">A</a>\n<ul>\n' +
        '<li><a href="#B">B</a></li>\n<li><a href="#D">D</a></li>\n</ul>\n</li>\n</ul>\n</nav>',
    )
    expect(out).not.toContain('href="#C"')
  })

  it('{from=X to=Y} selects an explicit level window', () => {
    const out = h('# A\n\n{from=2 to=2}\n::: toc\n:::\n\n## B\n\n### C\n\n## D\n')
    expect(out).toContain(
      '<nav class="toc">\n<ul>\n<li><a href="#B">B</a></li>\n<li><a href="#D">D</a></li>\n</ul>\n</nav>',
    )
    expect(out).not.toContain('href="#A"')
    expect(out).not.toContain('href="#C"')
  })

  it('carries the author {#id .class} onto <nav> but strips depth/from/to', () => {
    const out = h('# A\n\n{#nav .side depth=1}\n::: toc\n:::\n\n## B\n')
    expect(out).toContain('<nav class="toc side" id="nav">')
    expect(out).not.toContain('depth=')
  })

  it('swaps an inverted from/to window instead of emitting nothing', () => {
    const out = h('# A\n\n{from=3 to=1}\n::: toc\n:::\n\n## B\n\n### C\n')
    // 3..1 is treated as 1..3, so all three appear.
    expect(out).toContain('href="#A"')
    expect(out).toContain('href="#B"')
    expect(out).toContain('href="#C"')
  })

  it('renders an empty nav when there are no headings in range', () => {
    const out = h('::: toc\n:::\n\nplain paragraph\n')
    expect(out).toContain('<nav class="toc"></nav>')
  })

  it('preserves blocks authored inside the placeholder', () => {
    const out = h('# A\n\n::: toc\nSee below.\n:::\n\n## B\n')
    expect(out).toContain('<p>See below.</p>')
    expect(out).toContain('<nav class="toc">')
    expect(out.indexOf('See below.')).toBeLessThan(out.indexOf('<nav'))
  })

  it('degrades to a labeled placeholder when the extension is absent', () => {
    const out = carveToHtml('# A\n\n::: toc\n:::\n').trim()
    expect(out).toContain('class="toc"')
    expect(out).not.toContain('<nav')
  })
})

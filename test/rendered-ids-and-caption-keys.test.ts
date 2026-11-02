import { describe, expect, it } from 'vitest'
import { carveToHtml, expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

function expand(source: string, files: Record<string, string>) {
  const doc = parse(source, { positions: true })
  const result = expandIncludes(doc, source, { resolve: (path) => files[path] ?? null })
  return { ...result, rules: result.warnings.map((w) => w.rule), html: renderHtml(resolve(result.doc)) }
}

describe('an id dropped with an unresolved reference reserves nothing (CARVE-P2-004)', () => {
  it.each([
    ['footnote reference', 'x[^n]{#i}\n\n## i\n', '<p>x[^n]{#i}</p>'],
    ['full reference', '[a][r]{#i}\n\n## i\n', '<p>[a][r]{#i}</p>'],
    ['collapsed reference', '[r][]{#i}\n\n## i\n', '<p>[r][]{#i}</p>'],
    ['reference image', '![a][r]{#i}\n\n## i\n', '<p>![a][r]{#i}</p>'],
    ['id inside discarded link text', '[*a*{#i}][r]\n\n## i\n', '<p>[*a*{#i}][r]</p>'],
    ['footnote reference inside discarded link text', '[x[^n]{#i}][r]\n\n## i\n', '<p>[x[^n]{#i}][r]</p>'],
  ])('%s', (_name, source, paragraph) => {
    const html = carveToHtml(source)
    expect(html).toContain(paragraph)
    expect(html).toContain('<section id="i">')
  })

  it('a heading that already holds the id keeps it', () => {
    expect(carveToHtml('x[^n]{#i}\n\n{#i}\n# t\n')).toContain('<section id="i">')
  })

  it.each([
    ['defined footnote', 'x[^n]{#i}\n\n[^n]: b\n\n# i\n'],
    ['defined reference', '[a][r]{#i}\n\n[r]: /u\n\n# i\n'],
    ['bold span', '*a*{#i}\n\n# i\n'],
  ])('a rendered id still reserves: %s', (_name, source) => {
    expect(carveToHtml(source)).toContain('<section id="i-2">')
  })

  it('a reference the heading index resolves still reserves its id', () => {
    const html = carveToHtml('[H][]{#i}\n\n# H\n\n# i\n')
    expect(html).toContain('<a href="#H" id="i">H</a>')
    expect(html).toContain('<section id="i-2">')
  })

  it('an include renames a child id a parent reference may still hold', () => {
    const r = expand('[H][]{#i}\n\n# H\n\n{{ child }}', { child: '{#i}\npara' })
    expect(r.html).toContain('<a href="#H" id="i">H</a>')
    expect(r.html).toContain('<p id="i-2">para</p>')
  })

  it('a heading in a captioned quote is no target either', () => {
    const html = carveToHtml('[H][]{#i}\n\n> # H\n^ cap\n\n# i\n')
    expect(html).toContain('<p>[H][]{#i}</p>')
    expect(html).toContain('<section id="i">')
  })

  it('a quoted heading is no target, so the reference reserves nothing', () => {
    const html = carveToHtml('[H][]{#i}\n\n> # H\n\n# i\n')
    expect(html).toContain('<p>[H][]{#i}</p>')
    expect(html).toContain('<section id="i">')
  })
})

describe('a symbol counts toward a caption bucket key (CARVE-P2-022)', () => {
  it('as the caption shows it, in a bucket of its own', () => {
    const html = carveToHtml('||\n^ Fig :smile: #: a\n\n||\n^ Fig #: b\n\n||\n^ Fig :smile: #: c\n')
    expect(html).toContain('<caption>Fig :smile: 1: a</caption>')
    expect(html).toContain('<caption>Fig 1: b</caption>')
    expect(html).toContain('<caption>Fig :smile: 2: c</caption>')
  })

  it('inside markup too', () => {
    const html = carveToHtml('||\n^ Fig *:a:* #: x\n\n||\n^ Fig *:b:* #: y\n')
    expect(html).toContain('<strong>:a:</strong> 1: x')
    expect(html).toContain('<strong>:b:</strong> 1: y')
  })

  it('a comment contributes nothing', () => {
    const html = carveToHtml('||\n^ Fig #: a\n\n||\n^ Fig {#c#} #: c\n')
    expect(html).toContain('<caption>Fig <span class="critic-comment">c</span> 2: c</caption>')
  })

  it('a heading id still leaves a symbol out', () => {
    expect(carveToHtml('# a :smile:\n')).toContain('<section id="a">')
  })
})

describe('a div label keeps an escaped space before its comment (CARVE-P9-041)', () => {
  it.each([
    ['x\\  %% c', 'x&nbsp;'],
    ['x\\ %% c', 'x&nbsp;'],
    ['x\\\\  %% c', 'x\\'],
    ['x\\\\\\  %% c', 'x\\&nbsp;'],
    ['*x*\\  %% c', '<strong>x</strong>&nbsp;'],
    ['x  %% c', 'x'],
  ])('%s', (label, rendered) => {
    expect(carveToHtml(`::: note [${label}]\nbody\n:::\n`)).toContain(`<p class="div-label">${rendered}</p>`)
  })
})

import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

describe('Djot heading ID collisions', () => {
  it('matches the official headings.test:123 fixture', () => {
    const source = '{#Foo-bar}\nParagraph\n\n# Foo bar\n\n## Foo  bar\n\n{#baz}\n# Foo bar\n'
    const html = carveToHtml(djotToCarve(source))
    expect(html).toContain('<p id="Foo-bar">Paragraph</p>')
    expect(html).toContain('<section id="Foo-bar-1">')
    expect(html).toContain('<section id="Foo-bar-2">')
    expect(html).toContain('<section id="baz">')
  })

  it('uses suffix 1 for repeated generated headings', () => {
    const html = carveToHtml(djotToCarve('# A\n\n# A\n'))
    expect(html).toContain('<section id="A">')
    expect(html).toContain('<section id="A-1">')
  })

  it('skips explicit suffixes while continuing a generated collision chain', () => {
    const html = carveToHtml(djotToCarve('# A\n\n{#A-1}\np\n\n# A\n\n# A\n'))
    expect(html).toContain('<section id="A">')
    expect(html).toContain('<p id="A-1">p</p>')
    expect(html).toContain('<section id="A-2">')
    expect(html).toContain('<section id="A-3">')
  })

  it('does not reserve an explicit ID that appears later', () => {
    const html = carveToHtml(djotToCarve('# A\n\n{#A}\np\n'))
    expect(html).toContain('<section id="A">')
    expect(html).toContain('<p id="A">p</p>')
  })

  it('keeps a colliding heading inside a quote', () => {
    const html = carveToHtml(djotToCarve('{#A}\np\n\n> # A\n'))
    expect(html).toContain('<h1 id="A-1">A</h1>')
  })
})

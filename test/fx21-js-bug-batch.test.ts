import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, djotMigrationWarnings, htmlToCarve, parse } from '../src/index.js'

describe('container ownership across source columns', () => {
  it('ends a nested term when a table opener reaches its enclosing marker column', () => {
    const html = carveToHtml(':: a\n: b\n  :: c\n||\n')
    expect(html).toContain('<dt>c</dt>')
    expect(html).toContain('</dl>\n<table>')
    expect(carveToHtml(':: a\n: b\n  :: c\n ||\n')).toContain('<dt>c</dt>\n    </dl>\n  </dd>\n</dl>\n<table>')
  })

  it('places a block at a nested item marker column beside that item', () => {
    const html = carveToHtml('- :::\n   - a\n   ||\n')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('</ul>\n      <table>')
    expect(carveToHtml('> - :::\n>    - a\n>    ||\n')).toContain('</ul>\n        <table>')
  })

  it('keeps a marker-line term open through a lazy definition-shaped line', () => {
    expect(carveToHtml('- - :: t\n: a\n')).toContain('<dt>t\n: a</dt>')
  })

  it('splits a description paragraph before a second consecutive plus', () => {
    expect(carveToHtml(':: m\n: f\nl\n+\n+\n')).toContain('<p>f\nl</p>\n    <p>+</p>')
  })

  it('keeps a refused last plus in the first-block host', () => {
    expect(carveToHtml('- +\n+\n')).toBe('<ul>\n  <li>+</li>\n</ul>')
    expect(carveToHtml('- +\n+\n\n- tail\n')).toBe('<ul>\n  <li><p>+</p></li>\n  <li><p>tail</p></li>\n</ul>')
  })

  it('does not throw when a stacked item has no owned follower', () => {
    expect(carveToHtml('> - - +\n    x\n')).toContain('<li>+\nx</li>')
  })
})

describe('recognition, rendering and positions', () => {
  it('requires a complete first row on the fast HTML table path', () => {
    const html = carveToHtml('|\n|---|\n|\n')
    expect(html).toContain('<p>|</p>\n<table>')
    expect(html).not.toContain('<thead>')
  })

  it('accepts content tabs after a required marker separator', () => {
    expect(carveToHtml('-{} \tx\n')).toBe('<ul>\n  <li>\tx</li>\n</ul>')
    expect(carveToHtml('-{}\tx\n')).toBe('<p>-{}\tx</p>')
  })

  it('keeps every positioned column one-based after tab expansion', () => {
    const doc = parse('- o\n  :: m\n\t:\n', { positions: true })
    const positions: Array<{ startColumn?: number; endColumn?: number }> = []
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { for (const item of value) visit(item); return }
      const node = value as Record<string, unknown>
      if (node.pos) positions.push(node.pos as { startColumn?: number; endColumn?: number })
      for (const [key, child] of Object.entries(node)) if (key !== 'pos' && key !== 'attrs') visit(child)
    }
    visit(doc)
    expect(positions.length).toBeGreaterThan(0)
    for (const pos of positions) {
      expect(pos.startColumn).toBeGreaterThanOrEqual(1)
      expect(pos.endColumn).toBeGreaterThanOrEqual(1)
    }
  })

  it('numbers a caption on an indented standalone image', () => {
    expect(carveToHtml(' ![a](/u)\n^ #\n')).toContain('<figcaption>1</figcaption>')
  })

  it('places computed cell spans before authored attributes', () => {
    expect(carveToHtml('|{x} |<|\n')).toContain('<td colspan="2" x=""></td>')
  })

  it('omits Markdown habit findings inside parsed block comments', () => {
    const source = '%%%\n**hidden** ~~hidden~~\n%%%\n\n**visible**\n'
    expect(djotMigrationWarnings(source).map(warning => warning.rule)).toEqual(['markdown-strong-double-star'])
  })

  it('requires a title to license spaces after a nonempty image source', () => {
    expect(carveToHtml('![a](u )\n')).toBe('<p>![a](u )</p>')
    expect(carveToHtml('![a](u ){.x}\n')).toBe('<p>![a](u ){.x}</p>')
    expect(carveToHtml('![a]( )\n')).toBe('<img src="" alt="a">')
  })

  // A span's closer is not the next character for a quote after a slash (CARVE-P3-023 R1, ruling markup-carve/carve#4318).
  it('closes a quote after a slash at the end of a span', () => {
    expect(carveToHtml('*/"*\n')).toBe('<p><strong>/”</strong></p>')
    expect(carveToHtml("*/'*\n")).toBe('<p><strong>/’</strong></p>')
  })

  it('requires an unmarked delimiter cell before promoting a table header', () => {
    const html = carveToHtml('||\n|= -|\n')
    expect(html).not.toContain('<thead>')
    expect(html).toContain('<tr><th scope="row">-</th></tr>')
    expect(carveToHtml('||\n|> -|\n')).toContain('<td style="text-align: right;">-</td>')
  })
})

it('writes a safe empty nested item before a literal plus imported from HTML', () => {
  const html = '<ul><li>a<ul><li></li></ul>+</li></ul>'
  const imported = htmlToCarve(html)
  expect(imported.report.diagnostics).toEqual([])
  expect(imported.value).toContain('- %%')
  expect(carveToCarve(imported.value)).toBe(imported.value)
  expect(carveToHtml(imported.value)).toContain('<li></li>')
  expect(carveToHtml(imported.value)).toContain('</ul>\n    +\n  </li>')
})

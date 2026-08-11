import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, lintCarve, migrateCarve01To02 } from '../src/index.js'

describe('0.2 paragraph extent', () => {
  for (const [name, opener] of [
    ['heading', '# Heading'],
    ['quote', '> quoted'],
    ['thematic break', '---'],
    ['table', '| a |'],
    ['code fence', '```\ncode\n```'],
    ['div', '::: note\nbody\n:::'],
    ['definition list', ':: term\n: definition'],
    ['reference definition', '[r]: /url'],
    ['comment', '%% hidden'],
    ['block attributes', '{.class}'],
  ] as const) {
    it(`${name} needs block position`, () => {
      expect(carveToHtml(`intro\n${opener}`)).toMatch(/^<p>intro\n/)
      expect(carveToHtml(`intro\n\n${opener}`)).not.toMatch(/^<p>intro\n/)
    })
  }

  it('is uniform inside an explicitly marked quote', () => {
    expect(carveToHtml('> intro\n> # Heading')).toContain('<p>intro\n# Heading</p>')
    expect(carveToHtml('> intro\n>\n> # Heading')).toContain('<h1 id="Heading">Heading</h1>')
  })

  it('is uniform at a list item content column', () => {
    expect(carveToHtml('- intro\n  # Heading')).toContain('<li>intro\n# Heading</li>')
    expect(carveToHtml('- intro\n\n  # Heading')).toContain('<h1 id="Heading">Heading</h1>')
  })

  it('keeps the tight nested-list structural exception', () => {
    expect(carveToHtml('- intro\n  - nested')).toContain('<ul>\n      <li>nested</li>')
  })

  it('formats AST block boundaries with a blank line', () => {
    expect(carveToCarve('intro\n\n# Heading')).toBe('intro\n\n# Heading\n')
  })

  it('lints an opener-shaped paragraph continuation', () => {
    const warning = lintCarve('intro\n# Heading')
    expect(warning.map((item) => item.rule)).toContain('missing-blank-before-block')
    expect(lintCarve('intro\n\n# Heading').map((item) => item.rule)).not.toContain(
      'missing-blank-before-block',
    )
  })

  it('migrates 0.1 boundaries idempotently', () => {
    const migrated = migrateCarve01To02('intro\n# Heading\n\n> intro\n> ---\n')
    expect(migrated).toBe('intro\n\n# Heading\n\n> intro\n>\n> ---\n')
    expect(migrateCarve01To02(migrated)).toBe(migrated)
  })

  it('does not alter frontmatter content', () => {
    const source = '---\ntitle: X\n---\n\nbody\n'
    expect(migrateCarve01To02(source)).toBe(source)
  })

  it('does not invent a boundary before a list marker', () => {
    const source = 'intro\n- item\n'
    expect(migrateCarve01To02(source)).toBe(source)
  })
})

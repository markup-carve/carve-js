import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * `smartTypography` turns the resolved glyph back into the run the author
 * typed. It has to mean the same thing on every target, in the same spelling.
 *
 * It did not. HTML took the boolean `false` and ignored `'source'`; Markdown
 * took `'source'` and ignored `false`; plain text and ANSI had no option at
 * all and always emitted glyphs. So a caller who learned the shape from one
 * target and passed it to another got no error and no effect - a page that
 * looks configured and is not, which is the failure mode worth pinning
 * (carve#560).
 *
 * Both spellings are accepted rather than one being chosen, because both were
 * already documented and in use: the CLIs of carve-rs and carve-php take
 * `--smart-typography glyph|source`, and this package's HTML renderer took the
 * boolean.
 */

const SOURCE = 'He said "hello" -- a--b (c)\n'

const TARGETS = [
  { name: 'html', render: carveToHtml },
  { name: 'markdown', render: carveToMarkdown },
  { name: 'plain', render: carveToPlainText },
  { name: 'ansi', render: carveToAnsi },
] as const

const GLYPHS = /[“”–©]/

describe('smartTypography is honored on every target', () => {
  for (const { name, render } of TARGETS) {
    it(`${name}: the default resolves glyphs`, () => {
      expect(render(SOURCE)).toMatch(GLYPHS)
    })

    it(`${name}: 'source' emits what the author typed`, () => {
      const out = render(SOURCE, { smartTypography: 'source' })
      expect(out).not.toMatch(GLYPHS)
      expect(out).toContain('"hello"')
      expect(out).toContain('a--b')
      expect(out).toContain('(c)')
    })

    it(`${name}: the boolean spelling means the same thing`, () => {
      expect(render(SOURCE, { smartTypography: false })).toBe(
        render(SOURCE, { smartTypography: 'source' }),
      )
    })

    it(`${name}: 'glyph' is the default spelled out`, () => {
      expect(render(SOURCE, { smartTypography: 'glyph' })).toBe(render(SOURCE))
      expect(render(SOURCE, { smartTypography: true })).toBe(render(SOURCE))
    })
  }
})

describe('the targets agree with each other', () => {
  it('every target drops every glyph in source mode', () => {
    const glyphy = TARGETS.filter(({ render }) =>
      GLYPHS.test(render(SOURCE, { smartTypography: 'source' })),
    ).map(({ name }) => name)

    expect(glyphy).toEqual([])
  })
})

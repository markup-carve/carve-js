import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

const modes = ['safe', 'semantic', 'roundtrip'] as const

const written = (html: string) =>
  Object.fromEntries(modes.map((mode) => [mode, htmlToCarve(html, { mode }).value]))

describe('roundtrip mode reads a generated heading id back', () => {
  it('keeps the bare slug in every mode', () => {
    expect(written('<ul><li>a<h1 class="k" id="H">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {.k #H}\n  # H\n',
      semantic: '- a\n  {.k #H}\n  # H\n',
      roundtrip: '- a\n  {.k #H}\n  # H\n',
    })
  })

  it('keeps an unmarked dedup-shaped id too', () => {
    expect(written('<ul><li>a<h1 class="k" id="H-2">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {.k #H-2}\n  # H\n',
      semantic: '- a\n  {.k #H-2}\n  # H\n',
      roundtrip: '- a\n  {.k #H-2}\n  # H\n',
    })
  })

  it('keeps an unmarked id that was the only attribute', () => {
    expect(written('<ul><li>a<h1 id="H">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {#H}\n  # H\n',
      semantic: '- a\n  {#H}\n  # H\n',
      roundtrip: '- a\n  {#H}\n  # H\n',
    })
  })

  it('reads past the render annotation that is allowed to follow the id', () => {
    expect(written('<ul><li>a<h1 class="k" id="H" data-source-line="4">H</h1></li></ul>').roundtrip).toBe(
      '- a\n  {.k #H data-source-line=4}\n  # H\n',
    )
  })

  it('KEEPS an id an author wrote last, whose value is not the slug', () => {
    expect(written('<ul><li>a<h1 class="k" id="Other">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {.k #Other}\n  # H\n',
      semantic: '- a\n  {.k #Other}\n  # H\n',
      roundtrip: '- a\n  {.k #Other}\n  # H\n',
    })
  })

  it('KEEPS an id an author wrote first, even though its value IS the slug', () => {
    expect(written('<ul><li>a<h1 id="H" class="k">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {#H .k}\n  # H\n',
      semantic: '- a\n  {#H .k}\n  # H\n',
      roundtrip: '- a\n  {#H .k}\n  # H\n',
    })
  })
  it.each(['H-1', 'H-02', 'H-x', 'H-', 'H-2x'])('KEEPS %s, a tail that is not a dedup counter', (id) => {
    expect(written(`<ul><li>a<h1 class="k" id="${id}">H</h1></li></ul>`).roundtrip).toBe(
      `- a\n  {.k #${id}}\n  # H\n`,
    )
  })

  it('leaves the section-wrapped placement exactly where it was', () => {
    expect(written('<section id="H"><h1>H</h1></section>')).toEqual({
      safe: '# H\n',
      semantic: '# H\n',
      roundtrip: '# H\n',
    })
  })

  it.each([
    ['a generated id', '- a\n\n  {.k}\n  # H\n'],
    ['an authored id written last whose value IS the slug', '- a\n\n  {.k #H}\n  # H\n'],
    ['an authored id written first', '- a\n\n  {#H .k}\n  # H\n'],
    ['a second heading taking the -2 dedup form', '# H\n\n- a\n\n  {.k}\n  # H\n'],
  ])('re-renders %s to the same HTML it came from', (_label, source) => {
    for (const roundtrip of [false, true]) {
      const html = carveToHtml(source, { roundtrip })
      const back = htmlToCarve(html, { mode: 'roundtrip' }).value
      expect(carveToHtml(back, { roundtrip })).toBe(html)
    }
  })

  it('keeps unmarked ids on the writing exit', () => {
    expect(written('<ul><li>a<h1 class="k" id="H">H</h1></li></ul>').roundtrip).toBe('- a\n  {.k #H}\n  # H\n')
    expect(written('<ul><li>a<h1 class="k" id="H-2">H</h1></li></ul>').roundtrip).toBe('- a\n  {.k #H-2}\n  # H\n')
  })
})

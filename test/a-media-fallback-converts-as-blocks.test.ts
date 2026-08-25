import { describe, expect, it } from 'vitest'

import { carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * A MEDIA WRAPPER'S FALLBACK CONTENT CONVERTS AS BLOCKS (ruling
 * markup-carve/carve#1749).
 *
 * `<video controls><p>A</p><p>B</p></video>` wrote `A B` here and two
 * paragraphs in carve-php. Losing a paragraph boundary the author wrote is a
 * CONTENT change rather than a spelling difference: the document said two
 * things and came back saying one, and nothing about the wrapper being
 * unsupported requires its children to be reduced to a string - the fallback is
 * ordinary flow content Carve can spell.
 *
 * THE ROWS FALL OUT RATHER THAN BEING PORTED. Flattening reported an
 * `element-unwrapped` for every block it dissolved, and those rows were
 * truthful about that output. A `<p>` that survives as a paragraph is not
 * unwrapped and owes none, so a fix that kept them while changing the
 * conversion would start making false statements.
 *
 * THE ASSERTIONS ARE ON THE RE-RENDER, and on the BOUNDARY rather than on the
 * text: `A B` contains both strings too, so a test that only looked for the
 * words would pass the flatten this ruling removes.
 */
describe('a media fallback converts as blocks', () => {
  const family = ['video', 'audio', 'object', 'canvas', 'picture']

  const rendered = (html: string, mode: 'safe' | 'semantic' = 'safe') =>
    carveToHtml(htmlToCarve(html, { mode }).value)

  for (const tag of family) {
    for (const mode of ['safe', 'semantic'] as const) {
      it(`keeps the paragraph boundary inside a <${tag}> in ${mode}`, () => {
        const html = `<${tag}><p>A</p><p>B</p></${tag}>`
        // TWO paragraphs, not one run holding both words.
        expect(rendered(html, mode)).toContain('<p>A</p>')
        expect(rendered(html, mode)).toContain('<p>B</p>')
        expect(htmlToCarve(html, { mode }).value).toBe('A\n\nB\n')
      })
    }
  }

  /*
   * THE REST OF THE FLOW CONTENT, which is what says the answer is the
   * conversion and not a paragraph special case. Every one of these survives in
   * carve-php and flattened here.
   */
  const shapes: Array<[string, string, string]> = [
    ['a heading', '<h2>H</h2>', '## H\n'],
    ['a list', '<ul><li>a</li><li>b</li></ul>', '- a\n- b\n'],
    ['a quote', '<blockquote><p>Q</p></blockquote>', '> Q\n'],
    ['a code block', '<pre><code>x</code></pre>', '```\nx\n```\n'],
  ]

  for (const [what, inner, expected] of shapes) {
    it(`keeps ${what} inside a media wrapper`, () => {
      expect(htmlToCarve(`<video controls>${inner}</video>`).value).toBe(expected)
    })
  }

  it('owes one row for the wrapper and none for the blocks it kept', () => {
    const codes = htmlToCarve('<video controls><p>A</p><p>B</p></video>').report.diagnostics.map(
      (d) => d.code,
    )
    // One unwrap, for the `<video>` itself. The two `<p>` rows the flatten owed
    // are not owed any more, because the paragraphs are still there.
    expect(codes.filter((code) => code === 'element-unwrapped')).toEqual(['element-unwrapped'])
  })

  /*
   * `roundtrip` IS UNTOUCHED. Its answer for a media wrapper is the raw INLINE
   * span all three engines write - a media element is inline content in HTML -
   * and this ruling is about the fallback conversion the lossy modes do.
   */
  it('still preserves the whole element in roundtrip', () => {
    const result = htmlToCarve('<video controls><p>A</p><p>B</p></video>', { mode: 'roundtrip' })
    expect(result.value).toContain('{=html}')
    expect(result.value).toContain('<p>A</p><p>B</p>')
  })

  /*
   * THE CONTROLS. A media wrapper in an INLINE position is inline content and
   * stays that way, and a wrapper whose fallback is a bare run is still one
   * paragraph - the shapes that already converted correctly must not move.
   */
  it('leaves a media wrapper inside a paragraph inline', () => {
    expect(htmlToCarve('<p>x <video controls>fallback</video> y</p>').value).toBe('x fallback y\n')
  })

  it('leaves a bare fallback run as one paragraph', () => {
    expect(htmlToCarve('<video controls>fallback</video>').value).toBe('fallback\n')
  })

  it('still drops a media wrapper that brought nothing', () => {
    const codes = htmlToCarve('<video controls></video>').report.diagnostics.map((d) => d.code)
    expect(codes).toContain('element-dropped')
  })

  /*
   * NOT `iframe`, and the absence is measured. parse5 reads an `<iframe>`'s
   * content as raw TEXT, so it has no child elements for a block conversion to
   * reach, and `<embed>` is void. Naming them would be a branch no input takes.
   */
  it('leaves an iframe alone, whose content is raw text rather than elements', () => {
    expect(htmlToCarve('<iframe><p>A</p><p>B</p></iframe>').value).toContain('A')
  })
})

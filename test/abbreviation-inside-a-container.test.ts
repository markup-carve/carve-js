import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 9R R3 matches a term in RENDERED TEXT at word boundaries. The container
 * the text sits in does not change that.
 *
 * This engine dropped the expansion inside the `:name[…]` extension form, and
 * only there: an `inline_extension` keeps its inlines under `content`, while the
 * abbreviation walk recursed generically into `children`, so it never reached
 * them. carve-rs had the OPPOSITE hole - it dropped inside a span and expanded
 * inside `:name[…]` - and carve-php was right on every row, so the two engines
 * held opposite defects for months (markup-carve/carve#1151).
 *
 * Nothing caught it because the corpus pinned exactly one case here, the
 * explicit-`abbr` row every engine agreed on, leaving every neighbouring row
 * unpinned.
 */
describe('an abbreviation expands inside an inline container', () => {
  const html = (body: string): string => carveToHtml(`*[HTML]: Long Form\n\n${body}\n`).trim()
  const expanded = '<abbr title="Long Form">HTML</abbr>'

  it('expands inside the :name[…] extension form', () => {
    expect(html('The :kbd[HTML] key.')).toBe(
      `<p>The <span class="ext-kbd">${expanded}</span> key.</p>`,
    )
  })

  it('expands inside an ordinary span and a compact semantic span', () => {
    expect(html('The [HTML]{.x} key.')).toBe(`<p>The <span class="x">${expanded}</span> key.</p>`)
    expect(html('The [HTML]{kbd} key.')).toBe(`<p>The <kbd>${expanded}</kbd> key.</p>`)
  })

  it('CONTROLS: emphasis and a link already agreed, and must keep agreeing', () => {
    // These pin that the containers above are not being special-cased in one
    // direction - a fix that only widened the extension arm would leave these
    // untouched, so they are what tells the two apart.
    expect(html('Both *HTML* and [HTML](/u).')).toBe(
      `<p>Both <strong>${expanded}</strong> and <a href="/u">${expanded}</a>.</p>`,
    )
  })

  it('an explicit abbr attribute still wins over the definition', () => {
    // markup-carve/carve#1127: the authored expansion is the exception, and a
    // walk that reached further must not start applying the definition on top.
    expect(html('The [HTML]{abbr="Custom"} key.')).toBe(
      '<p>The <abbr title="Custom">HTML</abbr> key.</p>',
    )
  })
})

import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * An HTML block held by a container is a BLOCK there, as it is at the top
 * level.
 *
 * The importer used to answer the question twice, differently, and wrong both
 * times (markup-carve/carve-js#1045). In a block quote a `<footer>` never
 * matched the block condition at all - the line starts with `>` - so it fell
 * through to the inline converter and came back as a raw SPAN, wrapped in a
 * `<p>` the source did not have. `<p>` takes phrasing content, so that `<p>`
 * is invalid HTML. Under a list item the block WAS recognized, and then the
 * fence was written at column 0, which put it after the closing `</ul>`.
 *
 * Every expectation below was measured through `marked`, a CommonMark reader,
 * and not through carve-js. That is the whole reason the ticket exists: the
 * defect was first taken for correct behavior because the importer's own
 * output was the evidence. `marked` is not a dependency here, so its readings
 * are quoted in comments rather than asserted against - what is asserted is
 * the reading they establish.
 */
describe('a block-level HTML element inside a container', () => {
  describe('block quote', () => {
    it('is a raw block inside the quote, not a span in a paragraph', () => {
      // marked: <blockquote><p>quoted</p><footer>Socrates</footer></blockquote>
      const carve = markdownToCarve('> quoted\n>\n> <footer>Socrates</footer>\n')
      expect(carve).toBe('> quoted\n>\n> ```=html\n> <footer>Socrates</footer>\n> ```\n')
      const html = carveToHtml(carve)
      expect(html).toContain('<footer>Socrates</footer>')
      expect(html).not.toContain('<p><footer>')
    })

    it('interrupts the quoted paragraph above it', () => {
      // A condition-6 opener may interrupt a paragraph, so no blank quote line
      // is needed. marked reads the same two blocks here as with one.
      const carve = markdownToCarve('> quoted\n> <footer>Socrates</footer>\n')
      expect(carve).toBe('> quoted\n> ```=html\n> <footer>Socrates</footer>\n> ```\n')
      expect(carveToHtml(carve)).not.toContain('<p><footer>')
    })

    it('keeps its depth in a nested quote', () => {
      const carve = markdownToCarve('> > quoted\n> >\n> > <footer>x</footer>\n')
      expect(carve).toBe('> > quoted\n> >\n> > ```=html\n> > <footer>x</footer>\n> > ```\n')
      expect(carveToHtml(carve)).toMatch(/<blockquote>[\s\S]*<blockquote>[\s\S]*<footer>x<\/footer>/)
    })

    it('carries a multi-line element across the quote markers', () => {
      const carve = markdownToCarve('> a\n>\n> <div>\n> b\n> </div>\n')
      expect(carve).toBe('> a\n>\n> ```=html\n> <div>\n> b\n> </div>\n> ```\n')
      expect(carveToHtml(carve)).not.toContain('<p><div>')
    })

    it('reads an HTML comment as a block', () => {
      const carve = markdownToCarve('> a\n>\n> <!-- c -->\n')
      expect(carve).toBe('> a\n>\n> ```=html\n> <!-- c -->\n> ```\n')
      expect(carveToHtml(carve)).not.toContain('<p><!-- c -->')
    })

    it('reads a script element as a block', () => {
      // Condition 1. `x<1` is not markup, and inside a paragraph the inline
      // converter had to decide what to do with the stray `<`.
      const carve = markdownToCarve('> a\n>\n> <script>x<1</script>\n')
      expect(carve).toBe('> a\n>\n> ```=html\n> <script>x<1</script>\n> ```\n')
    })

    it('CONTROL: an inline element in the same position stays inline', () => {
      // marked: <blockquote><p>quoted</p><p><span>Socrates</span></p></blockquote>
      // The `<p>` here is the reader's, not the importer's invention, so it is
      // correct - this is what proves the fix discriminates.
      const carve = markdownToCarve('> quoted\n>\n> <span>Socrates</span>\n')
      expect(carve).toBe('> quoted\n>\n> `<span>Socrates</span>`{=html}\n')
      expect(carveToHtml(carve)).toContain('<p><span>Socrates</span></p>')
    })
  })

  describe('list item', () => {
    it('sits at the item content column, not at column 0', () => {
      // marked: <ul><li><p>item</p><footer>x</footer></li></ul>
      const carve = markdownToCarve('- item\n\n  <footer>x</footer>\n')
      expect(carve).toBe('- item\n\n  ```=html\n  <footer>x</footer>\n  ```\n')
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<footer>x<\/footer>[\s\S]*<\/li>/)
    })

    it('interrupts the item paragraph above it', () => {
      const carve = markdownToCarve('- item\n  <footer>x</footer>\n')
      expect(carve).toBe('- item\n  ```=html\n  <footer>x</footer>\n  ```\n')
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<footer>x<\/footer>[\s\S]*<\/li>/)
    })

    it('follows an ordered marker to its wider content column', () => {
      const carve = markdownToCarve('1. item\n\n   <footer>x</footer>\n')
      expect(carve).toBe('1. item\n\n   ```=html\n   <footer>x</footer>\n   ```\n')
      expect(carveToHtml(carve)).toMatch(/<ol>[\s\S]*<footer>x<\/footer>[\s\S]*<\/ol>/)
    })

    it('stays in the INNER item of a nested list', () => {
      // Four columns in, and not code: the nested item's content starts at
      // column 4, so the block carries no indent of its own. Read as an
      // indented code block, this lost the `=html` marker as well as the item.
      const carve = markdownToCarve('- a\n  - b\n\n    <footer>x</footer>\n')
      expect(carve).toBe('- a\n  - b\n\n    ```=html\n    <footer>x</footer>\n    ```\n')
      const html = carveToHtml(carve)
      expect(html).toContain('<footer>x</footer>')
      expect(html).not.toContain('&lt;footer&gt;')
    })

    it('reads an HTML comment as a block', () => {
      const carve = markdownToCarve('- a\n\n  <!-- c -->\n')
      expect(carve).toBe('- a\n\n  ```=html\n  <!-- c -->\n  ```\n')
      expect(carveToHtml(carve)).toMatch(/<li>[\s\S]*<!-- c -->[\s\S]*<\/li>/)
    })

    it('CONTROL: an inline element in the same position stays inline', () => {
      // marked: <ul><li><p>item</p><p><span>x</span></p></li></ul>
      const carve = markdownToCarve('- item\n\n  <span>x</span>\n')
      expect(carve).toBe('- item\n\n  `<span>x</span>`{=html}\n')
      expect(carveToHtml(carve)).toContain('<p><span>x</span></p>')
    })
  })

  describe('containers inside containers', () => {
    it('keeps the block in a list item that a quote holds', () => {
      // The quote marker AND the item's content column, in that order.
      const carve = markdownToCarve('> - item\n>\n>   <footer>x</footer>\n')
      expect(carve).toBe('> - item\n>\n>   ```=html\n>   <footer>x</footer>\n>   ```\n')
      expect(carveToHtml(carve)).toMatch(/<blockquote>[\s\S]*<li>[\s\S]*<footer>x<\/footer>/)
    })

    it('keeps the block in a quote that a list item holds', () => {
      // The quote itself still leaves the item here - the migrator dedents an
      // indented `>` to column 0, which is a separate defect on the container
      // axis. What this pins is that the element stays a BLOCK in that quote
      // rather than becoming a span in a paragraph.
      const carve = markdownToCarve('- item\n\n  > q\n  >\n  > <footer>x</footer>\n')
      expect(carve).toContain('> ```=html\n> <footer>x</footer>\n> ```')
      expect(carveToHtml(carve)).not.toContain('<p><footer>')
    })
  })

  describe('the top level, where the same rule was also spelled twice', () => {
    it('a condition-6 opener interrupts a paragraph', () => {
      // marked: <p>para</p><div>b</div>. The paragraph-run collector carried
      // the opener into the run, so the `<div>` stayed inline inside the `<p>`.
      const carve = markdownToCarve('para\n<div>\nb\n</div>\n')
      expect(carve).toBe('para\n\n```=html\n<div>\nb\n</div>\n```\n')
      expect(carveToHtml(carve)).not.toContain('<p>para\n<div>')
    })

    it('a condition-7 block runs to the blank line, not to its first line', () => {
      // Cut at the opening line, one element came back as three readings: a
      // fence holding `<span>`, a paragraph holding `b`, and an inline span
      // holding `</span>`.
      const carve = markdownToCarve('para\n\n<span>\nb\n</span>\n')
      expect(carve).toBe('para\n\n```=html\n<span>\nb\n</span>\n```\n')
      expect(carveToHtml(carve)).not.toContain('<p>b')
    })

    it('CONTROL: a condition-7 opener does NOT interrupt a paragraph', () => {
      // marked keeps all four lines in one paragraph. Only condition 7 is
      // barred from interrupting, and that is the whole difference between
      // this case and the `<div>` above.
      const carve = markdownToCarve('para\n<span>\nb\n</span>\n')
      expect(carve).toBe('para\n`<span>\nb\n</span>`{=html}\n')
    })
  })

  describe('CONTROL: positions that are not containers', () => {
    it('a table cell holds inline content, so the element stays a span', () => {
      // marked: <td><footer>x</footer></td> - inside the cell, inline.
      const carve = markdownToCarve('| a |\n|---|\n| <footer>x</footer> |\n')
      expect(carve).toContain('| `<footer>x</footer>`{=html} |')
      expect(carveToHtml(carve)).toContain('<td><footer>x</footer></td>')
    })

    it('an indented code block inside a list item is still code', () => {
      // Four columns past the item's content column, so CommonMark reads code
      // even though the content opens with a block tag.
      const carve = markdownToCarve('- a\n\n      <div>\n')
      expect(carve).not.toContain('=html')
    })
  })
})

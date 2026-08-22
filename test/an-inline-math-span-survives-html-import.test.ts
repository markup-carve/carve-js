import { describe, it, expect } from 'vitest'
import { HtmlImportLimitError, carveToHtml, htmlToAst, htmlToCarve, parse, renderMarkdown } from '../src/index.js'

/**
 * A math span survives an HTML import, inline and display alike.
 *
 * `<span class="math inline">\(x\)</span>` is what `carveToHtml` writes for
 * `` $`x` `` (PART 9 §18: `math_inline = '$', code_span`), and what djot.js and
 * pandoc write too. The importer had no arm for it, so it fell through to the
 * generic attributed-span writer and the equation came back as
 * `[\\(x\\)]{.math .inline}` - no diagnostic, and no `math` node
 * (carve-js#1277, after carve-php#1546).
 *
 * WHY THE OBVIOUS CHECK MISSED IT, and why every assertion below re-parses.
 * Re-rendering that span produces byte-identical HTML: a span carrying the same
 * classes renders the same tag. So an HTML-to-HTML comparison reports success on
 * the broken import. What is lost is the NODE - and with it every non-HTML
 * target, which has a math case and never reaches it. The `renderMarkdown` row
 * is the one that could see the defect at all.
 *
 * The recognition needs TWO signals to agree, the class pair and a matching
 * `\(…\)` / `\[…\]` payload, so neither a stylesheet class named `math` nor an
 * escaped paren in prose can turn text into an equation on its own.
 */

const kinds = (node: unknown, out: string[] = []): string[] => {
  if (!node || typeof node !== 'object') return out
  const n = node as { type?: string, children?: unknown[] }
  if (n.type) out.push(n.type)
  for (const child of n.children ?? []) kinds(child, out)
  return out
}

describe('an inline math span survives HTML import', () => {
  it('reads Carve\'s own math HTML back as a math node, not as an attributed span', () => {
    // THE TICKET'S MEASUREMENT. On main the AST held `span` and the source read
    // `Einstein said [\\(E = mc^2\\)]{.math .inline role=math} today.`
    const html = carveToHtml('Einstein said $`E = mc^2` today.')
    expect(html).toContain('<span class="math inline" role="math">\\(E = mc^2\\)</span>')

    expect(kinds(htmlToAst(html).value)).toEqual(['document', 'paragraph', 'text', 'math', 'text'])
    expect(htmlToCarve(html).value.trim()).toBe('Einstein said $`E = mc^2` today.')
  })

  it('keeps the display form too, which is the same hole one shape over', () => {
    const html = carveToHtml('Before\n\n$$`E = mc^2`\n\nAfter\n')
    expect(html).toContain('<span class="math display" role="math">\\[E = mc^2\\]</span>')
    expect(htmlToCarve(html).value.trim()).toBe('Before\n\n$$`E = mc^2`\n\nAfter')
  })

  it('re-parses to the tree it started from, which is the equality PART 11 §1 asks for', () => {
    for (const source of ['a $`x^2` b', 'a $$`\\int_0^1 x` b', '$$`E = mc^2`']) {
      const back = htmlToCarve(carveToHtml(source)).value
      expect(kinds(parse(back))).toEqual(kinds(parse(source)))
    }
  })

  it('reaches the non-HTML writers, which is what the lost node cost', () => {
    // The row an HTML-to-HTML check cannot see. On main this was
    // `a \\(x^2\\) b` - the TeX delimiters written out as prose, because the
    // Markdown writer's math case had a span in front of it.
    const back = htmlToCarve(carveToHtml('a $`x^2` b')).value
    expect(renderMarkdown(parse(back)).trim()).toBe('a $x^2$ b')
  })

  it('reads the pandoc / djot.js spelling, which carries no role attribute', () => {
    const inline = htmlToCarve('<p>a <span class="math inline">\\(E = mc^2\\)</span> b</p>')
    expect(inline.value.trim()).toBe('a $`E = mc^2` b')

    // The block form. It maps to the CORE display spelling rather than to a
    // ` ```math ` fence: that fence is an extension, and without the extension
    // loaded it renders as an ordinary `language-math` code block, so importing
    // to it would hand back an equation that is only an equation for some
    // readers.
    const block = htmlToCarve('<div class="math display">\\[E = mc^2\\]</div>')
    expect(block.value.trim()).toBe('$$`E = mc^2`')
    expect(kinds(htmlToAst('<div class="math display">\\[E = mc^2\\]</div>').value))
      .toEqual(['document', 'paragraph', 'math'])
  })

  it('keeps the author\'s id, extra classes and data attributes across the conversion', () => {
    const html = '<p>a <span id="e1" class="math inline extra" data-k="v">\\(x\\)</span> b</p>'
    expect(htmlToCarve(html).value.trim()).toBe('a $`x`{#e1 .extra data-k=v} b')
    // The base classes and `role="math"` are consumed by the recognition: the
    // renderer writes all of them back from the node, so keeping them would
    // spell one attribute twice.
    expect(carveToHtml(htmlToCarve(html).value)).toContain('class="math inline extra"')
  })

  it('carries a trailing attribute block on math through the round trip', () => {
    const html = carveToHtml('a $`x^2`{.c} span.')
    expect(html).toContain('<span class="math inline c" role="math">')
    expect(htmlToCarve(html).value.trim()).toBe('a $`x^2`{.c} span.')
  })

  it('needs both signals: a class alone is not an equation', () => {
    // A stylesheet is free to name a class `math`. Without a delimited payload
    // this stays the span it was.
    const r = htmlToCarve('<p>a <span class="math inline">not math</span> b</p>')
    expect(r.value.trim()).toBe('a [not math]{.math .inline} b')
    expect(kinds(htmlToAst('<p>a <span class="math inline">not math</span> b</p>').value))
      .toContain('span')
  })

  it('needs both signals: delimiters alone are not an equation', () => {
    // §18 dropped the bare `\(…\)` INPUT form, so these are escaped parens in
    // prose. The span is unwrapped exactly as any other unclassed span is.
    const r = htmlToCarve('<p>a <span>\\(x\\)</span> b</p>')
    expect(kinds(htmlToAst('<p>a <span>\\(x\\)</span> b</p>').value))
      .not.toContain('math')
    expect(r.report.diagnostics.map((d) => d.code)).toContain('element-unwrapped')
  })

  it('will not re-label a payload the class disagrees with', () => {
    // `math display` holding inline delimiters names no shape the renderer
    // writes. Recognizing it would invent the author's intent.
    expect(kinds(htmlToAst('<p><span class="math display">\\(x\\)</span></p>').value))
      .not.toContain('math')
    expect(kinds(htmlToAst('<p><span class="math inline">\\[x\\]</span></p>').value))
      .not.toContain('math')
    // Both states at once is a span with two classes, not an equation.
    expect(kinds(htmlToAst('<p><span class="math inline display">\\(x\\)</span></p>').value))
      .not.toContain('math')
  })

  it('reads the payload off the direct children, so an element child ends it', () => {
    // A delimiter payload is text. It is also read BEFORE the block arm has
    // charged the subtree, so the read has to be bounded and non-recursive -
    // otherwise crafted HTML reaches the stack ahead of the limit meant to
    // stop it.
    expect(kinds(htmlToAst('<p><span class="math inline"><i>\\(x\\)</i></span></p>').value))
      .not.toContain('math')
    expect(() => htmlToCarve('<div class="math display">' + '<div>'.repeat(4000) + '\\[x\\]'))
      .toThrow(HtmlImportLimitError)
  })

  it('costs the block form the same budget as the div it replaces, on BOTH limits', () => {
    /*
     * WHICH ARM A DIV TAKES MUST NOT CHANGE WHAT THE LIMITS SEE. The block arm
     * returns without walking its children, so it charges the subtree by hand -
     * and it has to charge from the depth the skipped traversal would have
     * started at, `depth + 1`, because the ordinary arm hands its children to
     * `blocks()` there. Charged from `depth` the subtree was one level short:
     * `maxNodes` agreed, and `maxDepth` admitted a math div at a ceiling that
     * rejected its own non-math twin.
     *
     * Asserted as an EQUALITY against a structurally identical twin rather than
     * against a number, so it stays true whatever the numbers become - and on
     * nested rows, because at the top level the two can agree by accident.
     */
    const ceiling = (html: string, key: 'maxNodes' | 'maxDepth'): number => {
      for (let n = 1; n < 64; n++) {
        try {
          htmlToAst(html, { [key]: n })

          return n
        } catch {
          continue
        }
      }
      throw new Error('no limit admits it')
    }
    const rows: Array<[string, string]> = [
      ['<div class="math display">\\[x\\]</div>', '<div class="mass display">\\[x\\]</div>'],
      [
        '<blockquote><div class="math display">\\[x\\]</div></blockquote>',
        '<blockquote><div class="mass display">\\[x\\]</div></blockquote>',
      ],
      ['<div><div class="math display">\\[x\\]</div></div>', '<div><div class="mass display">\\[x\\]</div></div>'],
    ]
    for (const [math, twin] of rows) {
      expect(ceiling(math, 'maxNodes')).toBe(ceiling(twin, 'maxNodes'))
      expect(ceiling(math, 'maxDepth')).toBe(ceiling(twin, 'maxDepth'))
    }
  })

  it('writes the shared import contract\'s math document, byte for byte', () => {
    // `tests/html-import/math-block-and-mathml` in the spec repo: the div, a
    // block `<math>` and an inline `<math>` in one input. The MathML half is
    // pinned on the BYTES because a stray `$` has no render difference to find.
    const html = '<div class="math display">\\[E = mc^2\\]</div>'
      + '<math display="block" alttext="a - b"></math>'
      + '<p>x <math alttext="c + d"></math> y</p>'
    expect(htmlToCarve(html).value).toBe('$$`E = mc^2`\n\n$$`a - b`\n\nx $`c + d` y\n')
  })

  it('is not fooled by delimiters with nothing between them', () => {
    expect(kinds(htmlToAst('<p><span class="math inline">\\(\\)</span></p>').value))
      .not.toContain('math')
  })

  it('folds a payload that arrived across lines, because a code span is one line', () => {
    const html = '<div class="math display">\\[\n  \\int_0^1 x^2\n  \\, dx\n\\]</div>'
    const back = htmlToCarve(html).value.trim()
    expect(back).toBe('$$`\\int_0^1 x^2 \\, dx`')
    // The point of the fold: what comes back is writable, and re-reads as math.
    expect(kinds(parse(back))).toEqual(['document', 'paragraph', 'math'])
  })

  it('keeps recognizing math in roundtrip mode, whose input is Carve\'s own HTML', () => {
    const html = carveToHtml('a $`x^2` b')
    expect(htmlToCarve(html, { mode: 'roundtrip' }).value.trim()).toBe('a $`x^2` b')
  })

  it('leaves the MathML path alone, and that path writes no stray closing sigil', () => {
    // carve-php#1546 found `$`x`$` there - Carve math has no closing delimiter,
    // so the trailing `$` was the next character of the paragraph. Fourteen byte
    // assertions agreed with it because none re-read the result. This one does.
    const back = htmlToCarve('<p>a <math alttext="x^2"><mi>x</mi></math> b</p>').value
    expect(back.trim()).toBe('a $`x^2` b')
    expect(kinds(parse(back))).toEqual(['document', 'paragraph', 'text', 'math', 'text'])
  })
})

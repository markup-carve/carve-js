import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A line inside a code fence decides nothing about the document around it.
 *
 * PART 9 §24 S2 makes a line verbatim once the innermost matched container is a
 * fenced body, and §28 says the same of a comment fence's body. Neither asks
 * what the line LOOKS like - which is the whole point of verbatim content.
 *
 * The definition prepass ran its container trackers BEFORE it asked whether an
 * open code fence had already claimed the line, so every structural spelling
 * inside a code sample was read as live structure. One ordering, three
 * symptoms, and all three end the same way: a definition written perfectly well
 * OUTSIDE the fence silently stops resolving, with no diagnostic, because of a
 * character in a sample somewhere above it (markup-carve/carve-js#1132).
 *
 * Each row below is verified against carve-rs 564a3b8 and carve-php 035dfcd
 * built from origin/main, and against the executable spec oracle. The oracle
 * and carve-rs agree with every expectation here; carve-php still swallows the
 * comment and verse rows, which is reported separately.
 *
 * The assertions are POSITIVE: the definition must actually resolve - an
 * `<abbr>` element, a real `href` - not merely stop being suppressed. A row
 * that only checked the symptom was gone would pass on a prepass that collected
 * nothing at all.
 */

const html = (source: string) => carveToHtml(source).replace(/\s+/g, ' ').trim()

describe('a structural line inside a code fence does not suppress what follows', () => {
  it('a `:::` line leaves the abbreviation at document level', () => {
    // The reported shape. `:::` pushed a div onto the prepass depth stack, and
    // the abbreviation branch registers ONLY at document level (PART 12 §7), so
    // the definition below a code sample containing a div fence was dropped.
    const source = '```\n:::\n```\n\n*[HTML]: HyperText Markup Language\n\nHTML is fine.\n'

    expect(html(source)).toBe(
      '<pre><code>::: </code></pre> <p><abbr title="HyperText Markup Language">HTML</abbr> is fine.</p>',
    )
  })

  it('a `%%%` line opens no comment region past the fence', () => {
    // Worse than the reported shape and found by widening the probe: the `%%%`
    // in the FIRST sample took the `%%%` in the second one as its closer, so
    // the opaque region ran across the definition between them. A link
    // reference, not just an abbreviation - the prepass is the only registrar
    // of both.
    const source = '```\n%%%\n```\n\n[r]: /url\n\n```\n%%%\n```\n\n[r][]\n'

    expect(html(source)).toContain('<a href="/url">r</a>')
  })

  it('a `::: |` line opens no verse region past the fence', () => {
    // The third tracker. A line block is verse, and a definition inside one is
    // text the author laid out - so an opener read out of a code sample
    // swallowed every definition after it.
    const source = '```\n::: |\n```\n\n[r]: /url\n\n[r][]\n'

    expect(html(source)).toContain('<a href="/url">r</a>')
  })

  it('a tilde fence is verbatim on the same terms', () => {
    // The fence CHARACTER is not the axis. Spelling the sample with `~~~`
    // reaches the identical prepass state, so a fix that only re-ordered the
    // backtick path would leave this red.
    const source = '~~~\n:::\n~~~\n\n*[HTML]: HyperText Markup Language\n\nHTML is fine.\n'

    expect(html(source)).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
  })

  it('a raw block is verbatim on the same terms', () => {
    // ```` ```=FORMAT ```` is opaque passthrough, tracked by the prepass through
    // its own opener pattern. Its interior is no more structural than a code
    // sample's.
    const source = '```=html\n:::\n```\n\n*[HTML]: HyperText Markup Language\n\nHTML is fine.\n'

    expect(html(source)).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
  })

  it('a fence at a list item content column is verbatim too', () => {
    // The fence does not have to be at column 0 for its interior to be
    // verbatim. This row also proves the moved check still re-bases the closer
    // to the column the fence opened at: read at column 0, the indented closer
    // would not match and the fence would run to the end of the document,
    // taking the definition with it for a DIFFERENT reason.
    const source = '- item\n\n  ```\n  :::\n  ```\n\n*[X]: expansion\n\nX here\n'

    expect(html(source)).toContain('<abbr title="expansion">X</abbr>')
    expect(html(source)).toContain('<pre><code>::: </code></pre>')
  })
})

describe('the constructs still work where they are real structure', () => {
  it('CONTROL: a real div DOES hold the abbreviation below document level', () => {
    // The boundary the fix must not move. `:::` outside a fence is a div, and
    // §7 recognizes an abbreviation definition only as a direct child of the
    // document - so an unclosed div really does suppress the definition inside
    // it. A change that simply stopped tracking divs would turn this row green
    // in the wrong direction, so it is asserted literally.
    const source = ':::\n\n*[HTML]: HTM Lang\n\nHTML is fine.\n'

    expect(html(source)).toBe(
      '<div> <p>*[HTML]: HTM Lang</p> <p>HTML is fine.</p> </div>',
    )
  })

  it('CONTROL: a real comment fence is still opaque to the prepass', () => {
    // §28's own rule, unchanged: a definition written inside a CLOSED `%%%`
    // registers nothing, because a comment's body is opaque. Collecting it
    // would make the label invisible in the output and active in the link table
    // at once.
    expect(html('%%%\n[r]: /url\n%%%\n\n[r][]\n')).toBe('<p>[r][]</p>')
  })

  it('CONTROL: a real verse block is still opaque to the prepass', () => {
    expect(html('::: |\n[r]: /url\n:::\n\n[r][]\n')).toContain('[r][]')
  })

  it('CONTROL: a closed div pops, so what follows is document level again', () => {
    // The pop half of the div tracker. Without it the fix's ordering change
    // could be mistaken for "divs no longer matter".
    const source = ':::\n:::\n\n*[HTML]: HTM Lang\n\nHTML is fine.\n'

    expect(html(source)).toContain('<abbr title="HTM Lang">HTML</abbr>')
  })
})

describe('shapes that were already right, and must stay right', () => {
  it('CONTROL: a definition INSIDE the code fence is a sample, not a definition', () => {
    // The rule in the other direction, and the reason the fence is tracked at
    // all. Documenting the syntax must not change the prose around it.
    expect(html('```\n[r]: /url\n```\n\n[r][]\n')).toContain('<p>[r][]</p>')
  })

  it('CONTROL: an UNCLOSED fence still swallows the definition after it', () => {
    // Moving the check earlier must not turn an unterminated fence into a
    // closed one: everything after an unclosed opener is still fence content.
    expect(html('```\n[r]: /url\n\n[r][]\n')).toContain('[r][]')
    expect(html('```\n[r]: /url\n\n[r][]\n')).not.toContain('href="/url"')
  })

  it('CONTROL: a balanced pair inside a fence never moved the answer', () => {
    // `::::` then `::::` pushes and pops, so the depth was back to zero by the
    // time the definition was read and the abbreviation registered even before
    // the fix. It is the shape that CANNOT distinguish the two orderings, kept
    // so the discriminating rows above are not mistaken for the whole class.
    const source = '```\n::::\n::::\n```\n\n*[X]: expansion\n\nX here\n'

    expect(html(source)).toContain('<abbr title="expansion">X</abbr>')
  })

  it('CONTROL: a code sample with no structural line at all', () => {
    const source = '```\nplain\n```\n\n*[HTML]: HTM Lang\n\nHTML is fine.\n'

    expect(html(source)).toContain('<abbr title="HTM Lang">HTML</abbr>')
  })
})

describe('a comment in a list item stays opaque, as §28 says', () => {
  /*
   * Filed alongside the shapes above as a second carve-js defect: a definition
   * inside a closed comment in a list item is collected by carve-rs and
   * carve-php and not by carve-js.
   *
   * carve-js is the one that is RIGHT. §24 S2 places a line by the column it
   * reaches, §28 makes a comment fence's body verbatim AND invisible, and the
   * corpus states the consequence outright: "A definition inside a comment
   * registers nothing". The corpus pins that only for a fence at column 0,
   * which is the gap that let the two other engines drift - and the executable
   * spec oracle answers as carve-js does on every row here.
   *
   * Pinned so the reported symmetry is never "fixed" by making carve-js match
   * the other two. Reported against carve-rs and carve-php instead.
   */

  it('a link definition in an item comment registers nothing', () => {
    expect(html('- item\n  %%%\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(
      '<ul> <li>item</li> </ul> <p>[r][]</p>',
    )
  })

  it('a comment on the marker line is opaque too', () => {
    expect(html('- %%%\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(
      '<ul> <li></li> </ul> <p>[r][]</p>',
    )
  })

  it('a wider fence in an item is opaque on its own width', () => {
    expect(html('- item\n  %%%%\n  [r]: /url\n  %%%%\n\n[r][]\n')).toContain('<p>[r][]</p>')
  })

  it('a comment in a NESTED item is opaque too', () => {
    expect(html('- a\n  - b\n    %%%\n    [r]: /url\n    %%%\n\n[r][]\n')).toContain('<p>[r][]</p>')
  })

  it('CONTROL: the same definition BELOW the item comment does register', () => {
    // The positive half. Without it every row above passes on an engine that
    // collects nothing after a list item at all, which is a real failure mode
    // this prepass has had before.
    expect(html('- item\n  %%%\n  hidden\n  %%%\n\n[r]: /url\n\n[r][]\n')).toContain(
      '<a href="/url">r</a>',
    )
  })

  it('CONTROL: an UNCLOSED comment in an item hides nothing', () => {
    // §28: an opener with no matching closer ahead does not open a block, so
    // the definition under it is an ordinary one and resolves.
    expect(html('- item\n  %%%\n  [r]: /url\n\n[r][]\n')).toContain('<a href="/url">r</a>')
  })
})

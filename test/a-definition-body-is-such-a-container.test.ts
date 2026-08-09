import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 0 S4, AND A DEFINITION BODY IS SUCH A CONTAINER -- NORMATIVE
 * (markup-carve/carve#956).
 *
 * A definition body's `dd` demands indentation to column 3
 * (`definition_indent`), so a fence opened on the `:  ` marker line whose body
 * sits BELOW that column is the LIST spelling with a different prefix. `body`
 * supplies none of the body's indentation, so S1 MATCH PREFIXES stops at the
 * DEFINITION ENTRY and S2 FENCED BODY never fires. S4 governs, its lazy branch
 * asks for an open PARAGRAPH, and a verbatim body is not one. The containers
 * close, the `dd` holds an EMPTY code block, and `body` re-parses at document
 * level.
 *
 * A definition body is the LAST container kind that collects an indented block,
 * so with this the rule is CLOSED over the set rather than enumerated across it.
 * The container kind was never a parameter of S4 (markup-carve/carve#920), which
 * is why every row below is written twice - once as a list item, once as a
 * definition body - and the two must answer alike.
 */

/** The blocks a document emits OUTSIDE its first container. */
const outside = (src: string): string =>
  carveToHtml(src)
    .split('\n')
    .filter((l) => !/^\s/.test(l))
    .join('\n')

describe('a definition body is such a container', () => {
  it('a fence on the marker line holds an empty code block', () => {
    expect(carveToHtml(':: t\n:  ```\nbody\n```\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code>\n</code></pre>\n  </dd>\n</dl>\n<p>body\n<code></code></p>',
    )
  })

  it('is byte for byte the answer corpus 276 pins for the list spelling', () => {
    // The clause's own argument: the two documents are the same shape with a
    // different prefix, so the only permitted difference is `ul`/`li` against
    // `dl`/`dt`/`dd`. Anything else means the two collectors still disagree.
    const list = carveToHtml('- ```\nbody\n```\n')
    const def = carveToHtml(':: t\n:  ```\nbody\n```\n')
    expect(def.replace(/<\/?d[ldt]>|<dd>|<\/dd>|\s*<dt>t<\/dt>/g, '')).toBe(
      list.replace(/<\/?ul>|<\/?li>/g, ''),
    )
  })

  it('a RAW fence on the marker line answers the same way', () => {
    // The other fence kind reaches the tracker through a second pattern, so a
    // fix wired to only one of them passes the row above and fails here.
    expect(outside(':: t\n:  ```=html\nbody\n```\n')).toBe(
      '<dl>\n</dl>\n<p>body\n<code></code></p>',
    )
  })

  it('a CLOSED fence holds no open paragraph either', () => {
    // The state has to keep moving after the marker line. A fence opened at the
    // body column and closed there leaves the `dd` with no open paragraph, so a
    // flush-left line below it is document-level - the same answer a closed
    // fence gives inside a list item.
    expect(carveToHtml(':: t\n:  ```\n   body\n   ```\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code>body\n</code></pre>\n  </dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('an EMPTY quote and a block-attribute line hold none either', () => {
    // The two other shapes S4 names as opening nothing. Both already answered
    // this way inside a list item and did not inside a `dd`.
    expect(outside(':: t\n:  >\ntail\n')).toContain('<p>tail</p>')
    expect(carveToHtml(':: t\n:  {#x}\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('CONTROL a body that DOES hold an open paragraph still takes the lazy line', () => {
    // The row an over-eager fix breaks: S4 removes the lazy fold only where
    // there is no paragraph to fold into.
    expect(carveToHtml(':: t\n:  body\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>body\ntail</dd>\n</dl>',
    )
    // A quote WITH text keeps its own trailing paragraph open, so the fold
    // survives there too.
    expect(carveToHtml(':: t\n:  > q\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>q\ntail</p></blockquote>\n  </dd>\n</dl>',
    )
  })

  it('CONTROL a paragraph AFTER the closed fence re-opens the fold', () => {
    // Proves the state is tracked rather than latched by the marker line: the
    // fence closes, `after` opens a paragraph at the body column, and `tail`
    // folds into it.
    expect(carveToHtml(':: t\n:  ```\n   body\n   ```\n   after\ntail\n')).toContain(
      '<p>after\ntail</p>',
    )
  })

  it('CONTROL an UNTERMINATED fence mid-paragraph is inline verbatim', () => {
    // Section 10's closer lookahead: with a paragraph already open and no
    // matching closer ahead, a fence-shaped run is part of that paragraph, so
    // the fold stays open. A tracker wired without the lookahead ends the body.
    expect(carveToHtml(':: t\n:  para ```\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>para <code>\ntail</code></dd>\n</dl>',
    )
    // The list spelling, which already answered this way.
    expect(carveToHtml('- para ```\ntail\n')).toBe(
      '<ul>\n  <li>para <code>\ntail</code></li>\n</ul>',
    )
  })

  it('the closer LOOKAHEAD decides a fence on a line the tracker sees', () => {
    // The marker line is seeded by hand and opens its fence unconditionally, so
    // it cannot exercise the lookahead - a mutant that answered "yes, there is a
    // closer" for every fence passed every row above. The lookahead only speaks
    // where a paragraph is ALREADY open and the fence sits at the body column.
    //
    // No matching closer ahead: the run is inline verbatim and PART of the open
    // paragraph, so the fold survives and `tail` stays in the `dd`.
    expect(carveToHtml(':: t\n:  para\n   ```\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>para\n<code>\ntail</code></dd>\n</dl>',
    )
    // The list spelling of the same document, which is where the rule comes from.
    expect(carveToHtml('- para\n  ```\ntail\n')).toBe(
      '<ul>\n  <li>para\n<code>\ntail</code></li>\n</ul>',
    )
    // CONTROL with a closer ahead: the fence really opens, the paragraph ends,
    // and `tail` leaves the `dd`. Without this row the one above passes on a
    // reader that never opens a fence at all.
    expect(carveToHtml(':: t\n:  para\n   ```\n   x\n   ```\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>para</p>\n    <pre><code>x\n</code></pre>\n  </dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('answers every S4 shape the same way a list item does', () => {
    const pairs: Array<[string, string]> = [
      ['- ```\nbody\n```\n', ':: t\n:  ```\nbody\n```\n'],
      ['- ```=html\nbody\n```\n', ':: t\n:  ```=html\nbody\n```\n'],
      ['- ```\n  body\n  ```\ntail\n', ':: t\n:  ```\n   body\n   ```\ntail\n'],
      ['- >\ntail\n', ':: t\n:  >\ntail\n'],
      ['- > q\ntail\n', ':: t\n:  > q\ntail\n'],
      ['- body\ntail\n', ':: t\n:  body\ntail\n'],
      ['- | a |\ntail\n', ':: t\n:  | a |\ntail\n'],
      ['- # h\ntail\n', ':: t\n:  # h\ntail\n'],
    ]
    // Compare only what fell OUT of the container: the two container kinds
    // render their own wrappers differently and tight-vs-loose differs, but S4
    // decides one thing - whether the line is inside or outside.
    const shape = (s: string) => outside(s).replace(/<\/?(ul|li|dl|dt|dd)>/g, '')
    const disagree = pairs.filter(([list, def]) => shape(list) !== shape(def))
    expect(disagree).toEqual([])
  })
})

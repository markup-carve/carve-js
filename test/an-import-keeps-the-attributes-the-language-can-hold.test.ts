import { describe, expect, it } from 'vitest'

import { carveToHtml, htmlToCarve } from '../src/index.js'
import { isDangerousAttrName } from '../src/render-html.js'

/**
 * The importer's attribute policy is a REFUSAL list, not a keep list.
 *
 * It used to be the other way round: `data-*` and a handful of named cases were
 * kept and EVERYTHING ELSE was dropped, so `<blockquote aria-label="note">`
 * imported as a bare quote. That is an accessibility regression, applied
 * silently and in bulk to exactly the documents an importer runs on, and it was
 * a choice rather than a limitation - Carve's attribute syntax holds the pair
 * fine (markup-carve/carve-js#1156, converging on carve-php).
 *
 * The safety half of the policy did NOT move: event handlers, the injection
 * sinks and `style` were stripped before and are stripped now. Every test here
 * that shows something surviving also shows the dangerous neighbor gone, so a
 * change that widened the refusal into nothing cannot pass by proving only that
 * `aria-label` came through.
 */
describe('an import keeps the attributes the language can hold', () => {
  it('keeps an aria attribute on a quote, and still drops the handler beside it', () => {
    const result = htmlToCarve('<blockquote aria-label="note" onmouseover="steal()" data-x="1">q</blockquote>')
    expect(result.value).toBe('{aria-label=note data-x=1}\n> q\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped event-handler attribute onmouseover on <blockquote>',
      }),
    ])
    expect(carveToHtml(result.value)).toBe('<blockquote aria-label="note" data-x="1"><p>q</p></blockquote>')
  })

  it('keeps a name nothing in the importer recognizes', () => {
    const result = htmlToCarve('<blockquote foo="bar">q</blockquote>')
    expect(result.value).toBe('{foo=bar}\n> q\n')
    expect(result.report.diagnostics).toEqual([])
  })

  it('keeps the accessibility, microdata and authoring attributes a page carries', () => {
    const kept: Array<[string, string]> = [
      ['<p role="note">a</p>', '{role=note}\na\n'],
      ['<p itemprop="name">a</p>', '{itemprop=name}\na\n'],
      ['<p dir="rtl">a</p>', '{dir=rtl}\na\n'],
      ['<p tabindex="0">a</p>', '{tabindex=0}\na\n'],
      ['<p contenteditable="true">a</p>', '{contenteditable=true}\na\n'],
      ['<p title="t">a</p>', '{title=t}\na\n'],
      // BARE, not `<p>`-wrapped. Since carve-js#1411 a lone image is a block
      // at every level, and since carve-js#1419 an authored `<p>` around one
      // carries a `structure-unspellable` row of its own - which is a true
      // statement about the paragraph and has nothing to say about `srcset`.
      ['<img src="a.png" alt="a" srcset="a2.png 2x">', '![a](a.png){srcset="a2.png 2x"}\n'],
      // `lang` reaches the same HTML attribute through PART 11's `:tag`
      // shorthand, which is the writer's spelling for it, not a loss.
      ['<p lang="fr">a</p>', '{:fr}\na\n'],
      // A value-less attribute comes back as PART 11 §6c's bare boolean.
      ['<p hidden>a</p>', '{hidden}\na\n'],
    ]
    for (const [html, carve] of kept) {
      const result = htmlToCarve(html)
      expect(result.value, html).toBe(carve)
      expect(result.report.diagnostics, html).toEqual([])
    }
  })

  it('refuses exactly the names the renderer refuses, from the renderer\'s own list', () => {
    /*
     * The point of the assertion is the WORD "exactly". The importer holds no
     * list of its own: it asks `isDangerousAttrName`, which is the PART 9 §25
     * name filter the HTML renderer applies to every attribute it writes. Two
     * hand-maintained lists would agree today and drift tomorrow, and the drift
     * that matters is an importer admitting a sink the renderer knows about.
     */
    const probe = ['aria-label', 'role', 'foo', 'data-x', 'onclick', 'onmouseover', 'onerror', 'srcdoc', 'formaction']
    for (const name of probe) {
      const result = htmlToCarve(`<blockquote ${name}="v">q</blockquote>`)
      const survived = result.value.includes(name)
      expect(survived, name).toBe(!isDangerousAttrName(name))
      expect(carveToHtml(result.value).includes(name), name).toBe(!isDangerousAttrName(name))
    }
  })

  it('refuses a name the Carve writer could not spell back unchanged', () => {
    /*
     * `escapeAttrKey` deletes the characters an attribute identifier may not
     * hold, so keeping `~onclick` would write `onclick` - an attribute the
     * source never carried, under the one name the whole policy exists to
     * refuse. Refusing at the import is what keeps the writer from inventing
     * it, so this is a security case and not a tidiness one.
     */
    for (const name of ['~onclick', 'xlink:href', '1foo']) {
      const result = htmlToCarve(`<blockquote ${name}="alert(1)">q</blockquote>`)
      expect(result.value, name).toBe('> q\n')
      expect(result.report.diagnostics, name).toEqual([
        expect.objectContaining({
          code: 'attribute-dropped',
          message: `Dropped unsupported attribute ${name} on <blockquote>: not spellable as a Carve attribute name`,
        }),
      ])
    }
  })

  it('leaves no dangerous scheme reachable through an attribute it now keeps', () => {
    const dangerous = [
      '<p><a href="javascript:alert(1)">x</a></p>',
      '<p><img src="javascript:alert(1)" alt="a"></p>',
      '<blockquote foo="javascript:alert(1)">q</blockquote>',
      '<blockquote background="javascript:alert(1)">q</blockquote>',
      '<blockquote aria-label="javascript:alert(1)">q</blockquote>',
      '<blockquote style="width:expression(alert(1))">q</blockquote>',
    ]
    for (const html of dangerous) {
      const rendered = carveToHtml(htmlToCarve(html).value)
      expect(rendered, html).not.toMatch(/javascript:/i)
      expect(rendered, html).not.toMatch(/expression\(/i)
      expect(rendered, html).not.toMatch(/\son[a-z]+=/i)
    }
  })

  it('does not re-emit a serializer\'s own round-trip marker as content', () => {
    const result = htmlToCarve('<p data-carve-src="# not this">a</p>')
    expect(result.value).toBe('a\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'attribute-dropped', message: 'Dropped round-trip marker data-carve-src on <p>' }),
    ])
  })

  it('lets no handler name reach the CARVE SOURCE, at any element the policy runs for', () => {
    /*
     * THE ADVERSARY'S NAMES, AND THE ARTIFACT THAT MATTERS.
     *
     * `onfocus`, `onpointerdown` and `onanimationstart` are in nobody's list of
     * literal handler names - carve-php enumerates five and shipped a write site
     * that consulted the enumeration alone, so `{onfocus=steal()}` reached its
     * Carve source while `onclick` on the same element was clean
     * (markup-carve/carve-php#1337's neighbor). An enumeration cannot be
     * complete: `on*` is unbounded and browsers keep adding to it.
     *
     * The assertion is on the CARVE SOURCE, not the rendered HTML. The HTML
     * renderer strips `on*` on output, so a render-level assertion passes while
     * the source is dirty - and the source is the artifact that gets stored,
     * diffed, hand-edited, and rendered by targets whose defenses are not the
     * HTML renderer's.
     *
     * carve-js has ONE site that consults the policy - `Importer.attrs()`, which
     * every element's attributes go through - so this list is a list of the
     * element categories that reach it, not of independent policy copies.
     */
    const sites: Array<[string, (attr: string) => string]> = [
      ['paragraph', (a) => `<p ${a}>q</p>`],
      ['heading', (a) => `<h1 ${a}>q</h1>`],
      ['blockquote', (a) => `<blockquote ${a}><p>q</p></blockquote>`],
      ['div', (a) => `<div ${a}><p>q</p></div>`],
      ['admonition aside', (a) => `<aside class="admonition note" ${a}><p>q</p></aside>`],
      ['details', (a) => `<details ${a}><summary>s</summary><p>q</p></details>`],
      ['list', (a) => `<ul ${a}><li>x</li></ul>`],
      ['list item', (a) => `<ul><li ${a}>x</li></ul>`],
      ['definition list', (a) => `<dl ${a}><dt>t</dt><dd>d</dd></dl>`],
      ['definition term', (a) => `<dl><dt ${a}>t</dt><dd>d</dd></dl>`],
      ['table', (a) => `<table ${a}><tr><td>a</td></tr></table>`],
      ['table row', (a) => `<table><tr ${a}><td>a</td></tr></table>`],
      ['table cell', (a) => `<table><tr><td ${a}>a</td></tr></table>`],
      ['table body', (a) => `<table><tbody ${a}><tr><td>a</td></tr></tbody></table>`],
      ['code block', (a) => `<pre ${a}><code>x</code></pre>`],
      ['thematic break', (a) => `<hr ${a}>`],
      ['figure', (a) => `<figure ${a}><img src="a.png" alt="a"><figcaption>c</figcaption></figure>`],
      ['emphasis', (a) => `<p><em ${a}>x</em></p>`],
      ['span', (a) => `<p><span ${a}>x</span></p>`],
      ['link', (a) => `<p><a href="u" ${a}>x</a></p>`],
      ['image', (a) => `<p><img src="u" alt="a" ${a}></p>`],
      ['code span', (a) => `<p><code ${a}>x</code></p>`],
      ['semantic span', (a) => `<p><kbd ${a}>x</kbd></p>`],
      ['hard break', (a) => `<p>a<br ${a}>b</p>`],
    ]
    for (const handler of ['onfocus', 'onpointerdown', 'onanimationstart']) {
      for (const [site, build] of sites) {
        for (const mode of ['safe', 'semantic'] as const) {
          const result = htmlToCarve(build(`${handler}="steal()"`), { mode })
          expect(result.value, `${site} / ${handler} / ${mode}`).not.toContain(handler)
          expect(
            result.report.diagnostics.some((d) => d.message.includes(handler)),
            `${site} / ${handler} / ${mode} went in silence`,
          ).toBe(true)
        }
      }
    }
  })

  it('BOUNDARY: roundtrip mode preserves raw HTML verbatim, handlers included', () => {
    /*
     * The one place a handler CAN reach the Carve source, and it does not go
     * through the attribute policy at all: the three raw-HTML passthroughs, all
     * gated on `mode: 'roundtrip'`, whose stated contract is Carve-produced -
     * therefore trusted - HTML. Unchanged by markup-carve/carve-js#1156 and
     * byte-identical before and after it; pinned here so the carve-out is a
     * decision on the record rather than an assumption, and so a future reader
     * cannot mistake the safe-mode guarantee above for a whole-importer one.
     */
    const raw = htmlToCarve('<form onfocus="steal()"><p>q</p></form>', { mode: 'roundtrip' })
    expect(raw.value).toContain('onfocus')
    expect(raw.report.diagnostics).toEqual([
      // This row used to claim a DROP that the `raw-preserved` row on the next
      // line undid - a report naming a loss which did not happen, the mirror of
      // the one carve-js#1156 was filed about. markup-carve/carve-js#1468 kept
      // the row and stopped it lying: the handler is in the output, which in a
      // mode not safe for untrusted input is a stronger signal than a drop and
      // takes `error` for it.
      expect.objectContaining({
        code: 'attribute-preserved',
        severity: 'error',
        message: 'Preserved event-handler attribute onfocus on <form> in the raw HTML this element is kept as',
      }),
      expect.objectContaining({ code: 'raw-preserved', severity: 'warning' }),
    ])
    // The same input in the modes whose contract is untrusted HTML.
    for (const mode of ['safe', 'semantic'] as const) {
      expect(htmlToCarve('<form onfocus="steal()"><p>q</p></form>', { mode }).value).not.toContain('onfocus')
    }
  })

  it('refuses a value that hides a dangerous URL where the renderer cannot see it', () => {
    /*
     * §25 blanks a value whose scheme LEADS it, which covers every attribute
     * holding one URL. A list-valued attribute holds several, and a safe first
     * entry hides the rest - so `srcset` was the shape where "keep the rest"
     * would have become a vulnerability rather than a fidelity win.
     */
    // Bare for the same reason as above: the `<p>` would add a row about the
    // paragraph to a list that is asserting what happens to the ATTRIBUTE.
    const result = htmlToCarve('<img src="a.png" alt="a" srcset="safe.png 1x, javascript:alert(1) 2x">')
    expect(result.value).toBe('![a](a.png)\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped srcset on <img>: its value carries a javascript URL the renderer does not reach',
      }),
    ])
    // A LEADING dangerous scheme is not refused here - the renderer blanks it,
    // and refusing it too would be a second copy of that rule.
    const leading = htmlToCarve('<blockquote foo="javascript:alert(1)">q</blockquote>')
    expect(leading.value).toBe('{foo=javascript:alert(1)}\n> q\n')
    expect(carveToHtml(leading.value)).toBe('<blockquote foo=""><p>q</p></blockquote>')
  })

  it('refuses a value a Carve attribute block cannot hold on one line', () => {
    // A quoted value ends at the line break, so writing this back emits an
    // attribute block that reparses as literal text - the attribute is lost
    // either way, and the document is corrupted on top.
    const result = htmlToCarve('<p aria-label="first&#10;second">x</p>')
    expect(result.value).toBe('x\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        message: 'Dropped aria-label on <p>: its value spans a line break, which a Carve attribute value cannot',
      }),
    ])
  })

  it('stores an attribute named after a prototype member as an own property', () => {
    // Plain assignment would run the `__proto__` setter, store nothing, and
    // lose the attribute in silence - the class of bug carve-js#886 fixed for
    // the lookup tables, reached here by keeping names the document chose.
    const result = htmlToCarve('<p __proto__="x">y</p>')
    expect(result.value).toBe('{__proto__=x}\ny\n')
    expect(result.report.diagnostics).toEqual([])
    expect(carveToHtml(result.value)).toBe('<p __proto__="x">y</p>')
  })

  it('says so when a node it keeps attributes for has no slot to put them in', () => {
    const result = htmlToCarve('<p>a<br foo="x">b</p>')
    expect(result.value).toBe('a\\\nb\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped foo on <br>: a hard break has no attribute slot',
      }),
    ])
  })

  it('does not write a link or image title twice', () => {
    // `title` is read into the node's own field for these two tags, so the
    // generic keep must not also hang it on the element as `{title=…}`.
    expect(htmlToCarve('<p><a href="u" title="t">x</a></p>').value).toBe('[x](u "t")\n')
    expect(htmlToCarve('<p><img src="u" alt="a" title="t"></p>').value).toBe('![a](u "t")\n')
  })

  it('keeps an explicitly empty link or image title', () => {
    // Consumed means READ, not "read if it looks interesting": a `title=""` is
    // a title the writer can spell and the renderer emits, and treating the
    // empty string as absent lost it with no diagnostic at all.
    expect(htmlToCarve('<p><a href="u" title="">x</a></p>').value).toBe('[x](u "")\n')
    expect(carveToHtml('[x](u "")\n')).toBe('<p><a href="u" title="">x</a></p>')
    expect(htmlToCarve('<p><img src="u" alt="a" title=""></p>').value).toBe('![a](u "")\n')
  })

  it('lets a mapped CSS declaration win over the presentational attribute, either order', () => {
    // CSS beats the presentational attribute in HTML, and the winner cannot
    // depend on which of the two the author wrote first - a plain assignment
    // made `align` win purely by being second.
    for (const html of [
      '<p style="text-align:left" align="right">x</p>',
      '<p align="right" style="text-align:left">x</p>',
    ]) {
      expect(htmlToCarve(html, { mode: 'semantic' }).value, html).toBe('{align=left}\nx\n')
    }
    expect(htmlToCarve('<p style="text-align:left" align="right">x</p>', { mode: 'semantic' }).report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        message: 'Dropped align on <p>: a mapped CSS declaration already sets it',
      }),
    ])
  })

  it('names the attribute a semantic span\'s own marker takes the slot of', () => {
    // `<kbd kbd="literal">` has one key and two claims on it. The marker wins,
    // and the loss is reported rather than overwritten in silence.
    const result = htmlToCarve('<p><kbd kbd="literal">x</kbd></p>')
    expect(result.value).toBe('[x]{kbd}\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({
        code: 'attribute-dropped',
        severity: 'warning',
        message: 'Dropped kbd on <kbd>: the name is this span\'s own semantic marker',
      }),
    ])
    // A different name on the same element is still carried.
    expect(htmlToCarve('<p><kbd aria-label="key">x</kbd></p>').value).toBe('[x]{aria-label=key kbd}\n')
  })
})

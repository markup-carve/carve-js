import { describe, expect, it } from 'vitest'

import { carveToHtml, codeGroup, htmlToCarve, index, mermaid, tabs } from '../src/index.js'
import { LABEL_DEFAULTS } from '../src/render-html.js'

/**
 * PART 9 §16a AN IMPORTER DOES NOT BAKE A DERIVED NAME INTO SOURCE
 * (markup-carve/carve#1500, reconciled with Extensions §1.5 in
 * markup-carve/carve#1511).
 *
 * An importer DROPS an attribute whose value EQUALS what the renderer derives
 * for that element and KEEPS every other one - the rule a `<th>`'s generated
 * `scope` already follows. It reaches every accessible name §16a and
 * Extensions §1.5 make engine-written, together with the `role` beside each.
 *
 * WHY A ROUND TRIP IS NOT THE TEST. Every shape below rebuilds byte-identical
 * at the default labels WHILE carrying the defect, so a round-trip assertion
 * passes and nothing is learned. The assertion has to be that the derived name
 * is ABSENT from the imported source - and, at the end of this file, that a
 * non-default `labels` map still reaches a document that has been imported.
 *
 * WHY THE NON-DEFAULT MAP IS THE DISCRIMINATOR. Rendering at the English
 * defaults cannot tell a name the engine DERIVED from one an author WROTE:
 * both read `aria-label="Tabs"`. Rendering the same source with a non-default
 * map separates them - a value that tracks the map was the engine's, and a
 * value that does not was the document's. carve#1511 found that no fixture in
 * the spec repo had ever rendered with a non-default map, so every one of the
 * thirteen keys had only ever been checked at its English default.
 *
 * THE CONTROLS ARE THE POINT. Reading the clause as "drop the name on a named
 * construct" rather than as "drop a value equal to the derived one" takes an
 * author's real label with it, which is the accessibility regression
 * carve-php#1337 and carve-rs#1060 record. Every family below carries a row
 * whose name DIFFERS and has to survive.
 */
describe('a derived accessible name does not come back from an HTML import', () => {
  /*
   * FAMILY 1 - DERIVED FROM THE ELEMENT'S OWN CLASS WORD.
   *
   * A diagram fence's name defaults to the extension's own class word, which is
   * why Extensions §1.5 keeps it OUT of the `labels` map: there is no fixed
   * English string to translate. So the derived value is readable off the
   * element itself, and the drop needs no knowledge of the render's options.
   */
  describe('a diagram fence', () => {
    it('drops the name that is its own class word, and the role beside it', () => {
      const html = carveToHtml('``` mermaid\ngraph TD; A-->B;\n```\n', { extensions: [mermaid()] })
      // `>` is deliberately NOT escaped by the fence renderer, so `-->` arrow
      // syntax survives into the client library.
      expect(html).toBe('<pre class="mermaid" role="img" aria-label="mermaid">graph TD; A-->B;</pre>')

      const result = htmlToCarve(html)
      expect(result.value).toBe('{.mermaid}\n```\ngraph TD; A-->B;\n```\n')
      expect(result.report.diagnostics).toEqual([])
    })

    it('keeps a name that differs from the class word, and still drops the role', () => {
      const result = htmlToCarve(
        '<pre class="mermaid" role="img" aria-label="Architecture overview">graph TD; A--&gt;B;</pre>',
      )
      expect(result.value).toBe(
        '{.mermaid aria-label="Architecture overview"}\n```\ngraph TD; A-->B;\n```\n',
      )
      expect(result.report.diagnostics).toEqual([])
    })

    it('keeps a role that is not the one the renderer derives', () => {
      const result = htmlToCarve('<pre class="mermaid" role="note">x</pre>')
      expect(result.value).toBe('{.mermaid role=note}\n```\nx\n```\n')
    })
  })

  /*
   * FAMILY 2 - AN AUTHORED DEFAULT FROM THE `labels` MAP.
   *
   * A tab set and a code group take their name from a key the host can set, so
   * unlike family 1 an author MAY have written the same words. The rule stays
   * value-matched: the ENGLISH DEFAULT is dropped, because at that value the
   * renderer writes it back and the output is identical either way. Anything
   * else - a German render, an author's own name - is kept.
   */
  describe('a tab set and a code group', () => {
    it('drops the group name at its documented default, and the role beside it', () => {
      const html = carveToHtml(':::: tabs\n::: tab [First]\nContent one.\n:::\n::::\n', {
        extensions: [tabs()],
      })
      expect(html).toContain(`<div class="tabs" role="group" aria-label="${LABEL_DEFAULTS.tabsGroup}">`)

      const source = htmlToCarve(html).value
      expect(source).not.toContain('aria-label=Tabs')
      expect(source).not.toContain('role=group')
      expect(source).toContain('{.tabs}')
    })

    it('drops the aria-mode role too, which is the other value it derives', () => {
      // The class stays - it is the author's, and it is what the renderer reads
      // to write the pair back.
      const source = htmlToCarve('<div class="tabs" role="tablist" aria-label="Tabs">x</div>').value
      expect(source).toBe('{.tabs}\n:::\nx\n:::\n')
    })

    it('keeps a group name rendered from a non-default labels map', () => {
      const html = carveToHtml(':::: tabs\n::: tab [First]\nContent one.\n:::\n::::\n', {
        extensions: [tabs()],
        labels: { tabsGroup: 'Registerkarten' },
      })
      const source = htmlToCarve(html).value
      expect(source).toContain('aria-label=Registerkarten')
    })

    it("keeps a group name the author wrote, which is what the blanket drop cost", () => {
      const source = htmlToCarve('<div class="tabs" role="group" aria-label="Build steps">x</div>').value
      expect(source).toContain('aria-label="Build steps"')
    })

    it('drops the code group name at its documented default', () => {
      const html = carveToHtml('::: code-group\n``` js [Node]\nconsole.log(1)\n```\n:::\n', {
        extensions: [codeGroup()],
      })
      expect(html).toContain(
        `<div class="code-group" role="group" aria-label="${LABEL_DEFAULTS.codeGroup}">`,
      )

      const source = htmlToCarve(html).value
      expect(source).not.toContain('aria-label="Code examples"')
      expect(source).not.toContain('role=group')
    })

    it('keeps a code group name rendered from a non-default labels map', () => {
      const html = carveToHtml('::: code-group\n``` js [Node]\nconsole.log(1)\n```\n:::\n', {
        extensions: [codeGroup()],
        labels: { codeGroup: 'Codebeispiele' },
      })
      expect(htmlToCarve(html).value).toContain('aria-label=Codebeispiele')
    })

    it('leaves the same pair alone on an element the renderer never names', () => {
      // The rule is keyed on the element the renderer derives FOR. A grouping
      // div that is not a tab set derives nothing, so both attributes stay.
      const source = htmlToCarve('<div role="group" aria-label="Tabs">x</div>').value
      expect(source).toBe('{role=group aria-label=Tabs}\n:::\nx\n:::\n')
    })
  })

  /*
   * FAMILY 3 - DERIVED FROM A SIBLING THE DOCUMENT ALREADY CARRIES.
   *
   * A `css`-mode tab panel is named by its own tab's `[label]`, which §16a
   * lists among the strings that get no key precisely because the author
   * already wrote it once, in the document. The importer reads the same string
   * off the `<label>` control that names the panel.
   */
  describe('a css-mode tab panel', () => {
    it("drops the name it takes from its tab's own label", () => {
      const html = carveToHtml(':::: tabs\n::: tab [First]\nContent one.\n:::\n::::\n', {
        extensions: [tabs({ mode: 'css' })],
      })
      expect(html).toContain('<div class="tabs-panel" role="group" aria-label="First">')

      const source = htmlToCarve(html).value
      expect(source).not.toContain('aria-label=First')
      expect(source).not.toContain('role=group')
    })

    it('drops a code-group panel name the same way', () => {
      const html = carveToHtml('::: code-group\n``` js [Node]\nconsole.log(1)\n```\n:::\n', {
        extensions: [codeGroup()],
      })
      expect(html).toContain('<div class="code-group-panel" role="group" aria-label="Node">')
      expect(htmlToCarve(html).value).not.toContain('aria-label=Node')
    })

    it("keeps a panel name that differs from its tab's label", () => {
      const source = htmlToCarve(
        '<div class="tabs">' +
          '<label for="t1" class="tabs-label">First</label>' +
          '<div class="tabs-panel" role="group" aria-label="Erste Registerkarte">x</div>' +
          '</div>',
      ).value
      expect(source).toContain('aria-label="Erste Registerkarte"')
    })

    it('keeps a panel name when no tab beside it derives one', () => {
      const source = htmlToCarve('<div class="tabs-panel" role="group" aria-label="First">x</div>').value
      expect(source).toContain('aria-label=First')
    })
  })

  /*
   * FAMILY 4 - A PER-RENDER COUNTER.
   *
   * A titled admonition's title paragraph carries `id="adm-N"`, where N is the
   * renderer's own document-order counter and the `aria-labelledby` on the
   * `<aside>` points at it. Imported as source the id is authored, so the next
   * render's counter collides with it. The derived value is exactly `adm-N`
   * for the Nth such paragraph, so the match is by equality and not by shape.
   */
  describe('an admonition title', () => {
    it('drops the counter id the renderer derives, at both positions', () => {
      const html = carveToHtml('::: note "A"\nx\n:::\n\n::: tip "B"\ny\n:::\n')
      expect(html).toContain('<p class="admonition-title" id="adm-1">A</p>')
      expect(html).toContain('<p class="admonition-title" id="adm-2">B</p>')

      const source = htmlToCarve(html).value
      expect(source).not.toContain('#adm-1')
      expect(source).not.toContain('#adm-2')
      expect(source).toContain('{.admonition-title}')
    })

    it('keeps an id that is not the counter value for its position', () => {
      const source = htmlToCarve(
        '<aside class="admonition note" aria-labelledby="adm-7">' +
          '<p class="admonition-title" id="adm-7">A</p><p>x</p></aside>',
      ).value
      expect(source).toContain('#adm-7')
    })

    it('keeps an id the author chose', () => {
      const source = htmlToCarve('<p class="admonition-title" id="intro">A</p>').value
      expect(source).toContain('#intro')
    })

    it('keeps a counter-shaped id on a title the counter never counted', () => {
      // No aside naming it back, so the renderer's counter never reached this
      // paragraph. Matching the SHAPE `adm-N` instead of the value would take
      // it, which is the guess this rule does not make.
      const source = htmlToCarve('<p class="admonition-title" id="adm-1">A</p>').value
      expect(source).toContain('#adm-1')
    })

    /*
     * THE TWO SHAPES THAT CARRY THE CLASS AND NO COUNTER, both ahead of a real
     * title so a counter keyed on the class alone is off by one and keeps the
     * derived id it should drop. Found by review of the first cut, which did
     * exactly that.
     */
    it('counts past a non-canonical title, which takes no counter value', () => {
      const html = carveToHtml('::: custom "T"\nx\n:::\n\n::: note "A"\ny\n:::\n')
      expect(html).toContain('<div class="custom">\n  <p class="admonition-title">T</p>')
      expect(html).toContain('<p class="admonition-title" id="adm-1">A</p>')

      expect(htmlToCarve(html).value).not.toContain('#adm-1')
    })

    it('counts past a titled admonition the author named, for the same reason', () => {
      const html = carveToHtml(
        '{aria-label="Mine"}\n::: note "T"\nx\n:::\n\n::: note "A"\ny\n:::\n',
      )
      expect(html).toContain('<aside class="admonition note" aria-label="Mine">')
      expect(html).toContain('<p class="admonition-title" id="adm-1">A</p>')

      expect(htmlToCarve(html).value).not.toContain('#adm-1')
    })
  })

  /*
   * FAMILY 5 - A COMPOSITE OF A MAP LABEL AND THE DOCUMENT'S OWN WORDS.
   *
   * An index back-link is named `{indexBackref} {term}`, or `{indexBackref}
   * {term} {k}` for the kth of several. Both halves are on the page - the term
   * is the entry's own text and k is the link's position among its siblings -
   * so the whole derived value is reconstructable and the match stays exact.
   */
  describe('an index back-link', () => {
    it('drops the composite name for a single occurrence', () => {
      const html = carveToHtml('A :index[gadget] word.\n\n::: index\n:::\n', {
        extensions: [index()],
      })
      expect(html).toContain(`aria-label="${LABEL_DEFAULTS.indexBackref} gadget"`)
      expect(htmlToCarve(html).value).not.toContain('aria-label="Back to gadget"')
    })

    it('drops the numbered name of the kth occurrence', () => {
      const html = carveToHtml('A :index[gadget] and :index[gadget].\n\n::: index\n:::\n', {
        extensions: [index()],
      })
      expect(html).toContain('aria-label="Back to gadget 1"')
      expect(html).toContain('aria-label="Back to gadget 2"')

      const source = htmlToCarve(html).value
      expect(source).not.toContain('aria-label="Back to gadget 1"')
      expect(source).not.toContain('aria-label="Back to gadget 2"')
    })

    it('keeps a back-link name rendered from a non-default labels map', () => {
      const html = carveToHtml('A :index[gadget] word.\n\n::: index\n:::\n', {
        extensions: [index()],
        labels: { indexBackref: 'Zurück zu' },
      })
      expect(htmlToCarve(html).value).toContain('aria-label="Zurück zu gadget"')
    })
  })

  /*
   * THE POINT OF THE WHOLE PASS, stated as one measurement: after an import,
   * a host that sets `labels` still reaches the document. With a derived name
   * baked into source, §12's author-wins rule makes the imported copy WIN and
   * the map stops reaching it - permanently, while every byte of today's
   * output at the default is unchanged.
   *
   * THE MAP HAS TO BE THE THING UNDER TEST, which means rendering the imported
   * source somewhere the map is READ. A round trip of this engine's own render
   * is not such a place: a rendered set imports as a `tabs` div holding a
   * `tabs-panel` div, and the extension claims a `tabs` div holding `tab`
   * children (markup-carve/carve-php#1543), so that re-render writes no
   * accessible name at all and consults no `labels` map. So the CONTAINER is
   * pinned to the one the renderer writes - name, role and all, since that is
   * the pair the import has to drop - and its child is written in the shape
   * that comes back claimable. Now one render reads both the map and the
   * imported source, which is the only place the two can be told apart.
   *
   * THE FIRST CUT MEASURED NEITHER HALF (markup-carve/carve-js#1297, found by
   * the port in markup-carve/carve-rs#1224). It re-rendered the bare divs, so
   * the assertion held identically with the map set to German, set to the
   * English default, and removed - the discriminator this whole file is built
   * on was inert in the one test named for it.
   */
  it('leaves a non-default labels map reaching a tab set that came through an import', () => {
    const container = `<div class="tabs" role="group" aria-label="${LABEL_DEFAULTS.tabsGroup}">`
    // Pinned against a real render, so the HTML imported below cannot drift
    // away from the pair this engine actually writes.
    expect(
      carveToHtml(':::: tabs\n::: tab [First]\nContent one.\n:::\n::::\n', {
        extensions: [tabs()],
      }),
    ).toContain(container)

    const source = htmlToCarve(`${container}<div class="tab">Content one.</div></div>`).value

    const german = carveToHtml(source, {
      extensions: [tabs()],
      labels: { tabsGroup: 'Registerkarten' },
    })
    expect(german).toContain('aria-label="Registerkarten"')
    // Evidence rather than decoration: a name the import had baked into source
    // is the one author-wins would pin this render to instead.
    expect(german).not.toContain(`aria-label="${LABEL_DEFAULTS.tabsGroup}"`)
  })

  /*
   * NOTHING IS LOST, SO NOTHING IS DIAGNOSED. The renderer writes the value
   * back, so a value-matched drop is not a lossy decision - the same reason the
   * `<figure>` and `<blockquote cite>` imports report nothing.
   */
  it('reports no attribute-dropped for a value-matched drop', () => {
    const html = carveToHtml('``` mermaid\ngraph TD; A-->B;\n```\n', { extensions: [mermaid()] })
    expect(htmlToCarve(html).report.diagnostics).toEqual([])
  })
})

/*
 * markup-carve/carve#1500 step 2. The default match catches a document rendered
 * in ENGLISH and nothing else - one rendered with a `labels` map carries a value
 * no default equals, so its generated name was kept and baked into the imported
 * source. A translated document is exactly the one §16a's map exists to serve.
 *
 * The host that rendered the HTML knows the map it used, so passing the same one
 * closes it. Omitting it changes nothing, which is asserted rather than assumed.
 */
describe('an import takes the labels map the HTML was rendered with', () => {
  const de = { tabsGroup: 'Registerkarten', codeGroup: 'Codebeispiele' }
  const tabsSrc = ':::: tabs\n\n::: tab [Eins]\na\n:::\n\n::::\n'

  it('drops a translated name when the map is supplied', () => {
    const html = carveToHtml(tabsSrc, { labels: de, extensions: [tabs()] })
    expect(html).toContain('aria-label="Registerkarten"')

    const back = htmlToCarve(html, { labels: de }).value
    expect(back).not.toContain('aria-label')
  })

  it('still keeps it without the map, which is the residue this closes', () => {
    const html = carveToHtml(tabsSrc, { labels: de, extensions: [tabs()] })

    expect(htmlToCarve(html).value).toContain('aria-label=Registerkarten')
  })

  it('still drops the English default when no map is supplied', () => {
    const html = carveToHtml(tabsSrc, { extensions: [tabs()] })

    expect(htmlToCarve(html).value).not.toContain('aria-label')
  })

  /*
   * The host's map is LAYERED over the defaults, so naming one key leaves every
   * other construct matched as before. A map that blinded the importer to the
   * defaults would trade one residue for a larger one.
   */
  it('a partial map still matches the defaults for every other key', () => {
    const html = carveToHtml(
      '::: code-group\n\n``` php [PHP]\n1;\n```\n\n:::\n',
      { labels: { tabsGroup: 'Registerkarten' }, extensions: [codeGroup()] },
    )

    expect(htmlToCarve(html, { labels: { tabsGroup: 'Registerkarten' } }).value).not.toContain('aria-label')
  })

  /*
   * An authored name still survives either way - its value differs from the
   * derived one whether or not a map is supplied (carve-js#1156).
   */
  it('keeps an authored name with the map supplied', () => {
    const back = htmlToCarve('<div class="tabs" aria-label="My tab set"><p>x</p></div>', { labels: de }).value

    expect(back).toContain('aria-label="My tab set"')
  })
})

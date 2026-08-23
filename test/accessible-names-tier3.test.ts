import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { index } from '../src/index-terms.js'
import { tabs } from '../src/tabs.js'
import { codeGroup } from '../src/code-group.js'
import { mermaid, fencedRender } from '../src/fenced-render.js'
import { headingPermalinks } from '../src/heading-permalinks.js'
import { tableOfContents, tocPlacement } from '../src/table-of-contents.js'
import { LABEL_DEFAULTS } from '../src/render-html.js'

/*
 * carve#1468 / carve#1469: a Tier-3 extension that writes an element writes its
 * accessible NAME too. Each block below had a role, or a visible label on its
 * parts, and nothing a reader could use to tell the whole from the next one.
 */
describe('index back-links say where they go (carve#1469)', () => {
  it('names a lone back-link by label + term, and leaves the glyph alone', () => {
    const out = carveToHtml('A :index[widget] here.\n\n::: index\n:::\n', {
      extensions: [index()],
    })
    expect(out).toContain(
      '<a href="#idx-widget-1" class="index-backref" aria-label="Back to widget">↩</a>',
    )
  })

  it('numbers the k-th of several BOTH visibly and in the name (WCAG 2.5.3)', () => {
    // The whole point: an index entry has one back-link per occurrence, so
    // without the ordinal a reader meets a row of identical unnamed arrows.
    const out = carveToHtml('A :index[widget] and :index[widget] again.\n\n::: index\n:::\n', {
      extensions: [index()],
    })
    expect(out).toContain('aria-label="Back to widget 1">↩<sup>1</sup></a>')
    expect(out).toContain('aria-label="Back to widget 2">↩<sup>2</sup></a>')
  })

  it('takes the label from the extension when one is passed', () => {
    const out = carveToHtml('A :index[widget] here.\n\n::: index\n:::\n', {
      extensions: [index({ backrefLabel: 'Zurück zu' })],
    })
    expect(out).toContain('aria-label="Zurück zu widget"')
  })

  it('escapes a term that carries markup characters', () => {
    const out = carveToHtml('A :index["quoted"] here.\n\n::: index\n:::\n', {
      extensions: [index()],
    })
    expect(out).not.toMatch(/aria-label="[^"]*"[^"]*"/)
  })
})

describe('a tab set and a code group are named as a whole (carve#1468)', () => {
  const tabSrc = ':::: tabs\n\n::: tab [One]\na\n:::\n\n::: tab [Two]\nb\n:::\n\n::::\n'

  it('names the CSS-mode set without inventing tab roles it cannot honor', () => {
    expect(carveToHtml(tabSrc, { extensions: [tabs()] })).toContain(
      '<div class="tabs" role="group" aria-label="Tabs">',
    )
  })

  it('keeps tablist in aria mode and adds the missing name', () => {
    expect(carveToHtml(tabSrc, { extensions: [tabs({ mode: 'aria' })] })).toContain(
      '<div class="tabs" role="tablist" aria-label="Tabs">',
    )
  })

  it('names a code group, whose own docblock used to send you to tabs for this', () => {
    const src = '::: code-group\n\n``` php [PHP]\n$x = 1;\n```\n\n:::\n'
    expect(carveToHtml(src, { extensions: [codeGroup()] })).toContain(
      '<div class="code-group" role="group" aria-label="Code examples">',
    )
  })

  it("does not write over the author's own name", () => {
    const src = '{aria-label="Mine"}\n:::: tabs\n\n::: tab [One]\na\n:::\n\n::::\n'
    const out = carveToHtml(src, { extensions: [tabs()] })
    expect(out).toContain('aria-label="Mine"')
    expect(out).not.toContain('aria-label="Tabs"')
  })

  it('leaves an attribute the author placed exactly where they placed it', () => {
    const src = '{#t1}\n:::: tabs\n\n::: tab [One]\na\n:::\n\n::::\n'
    expect(carveToHtml(src, { extensions: [tabs()] })).toContain(
      '<div class="tabs" id="t1" role="group" aria-label="Tabs">',
    )
  })
})

describe('a rendered diagram fence is an image with a name (carve#1468)', () => {
  it('names the hydration element so the SOURCE is not announced as prose', () => {
    const out = carveToHtml('``` mermaid\ngraph TD;\n```\n', { extensions: [mermaid()] })
    expect(out).toContain('<pre class="mermaid" role="img" aria-label="mermaid">')
  })

  it('takes a host-supplied name', () => {
    const out = carveToHtml('``` mermaid\ngraph TD;\n```\n', {
      extensions: [mermaid({ label: 'Deploy flow' })],
    })
    expect(out).toContain('aria-label="Deploy flow"')
  })

  it('writes role and name TOGETHER or not at all', () => {
    // An `img` with no accessible name is SKIPPED, which is worse than the
    // source being read out - so an empty label removes the role as well.
    const out = carveToHtml('``` mermaid\ngraph TD;\n```\n', {
      extensions: [mermaid({ label: '' })],
    })
    expect(out).toContain('<pre class="mermaid">')
    expect(out).not.toContain('role="img"')
  })

  it('still adds the role when the author supplied only a NAME', () => {
    // The author who cared enough to name the fence is exactly the one who must
    // not lose the role: without it the source is still announced as prose.
    const out = carveToHtml('{aria-label="Deploy flow"}\n``` mermaid\ngraph TD;\n```\n', {
      extensions: [mermaid()],
    })
    expect(out).toContain('aria-label="Deploy flow"')
    expect(out).toContain('role="img"')
    expect(out).not.toContain('aria-label="mermaid"')
  })

  it("keeps the author's own role", () => {
    const out = carveToHtml('{role="none"}\n``` mermaid\ngraph TD;\n```\n', {
      extensions: [mermaid()],
    })
    expect(out).toContain('role="none"')
    expect(out).not.toContain('role="img"')
  })

  it('does not name the source fallback, which really is source text', () => {
    const out = carveToHtml('``` mermaid\ngraph TD;\n```\n', {
      extensions: [mermaid()],
      mode: 'static',
    })
    expect(out).toContain('<code class="language-mermaid">')
    expect(out).not.toContain('role="img"')
  })

  it('stays byte-identical to the factory it is a preset of', () => {
    const src = '``` mermaid\ngraph TD;\n```\n'
    expect(carveToHtml(src, { extensions: [mermaid()] })).toBe(
      carveToHtml(src, { extensions: [fencedRender({ language: 'mermaid' })] }),
    )
  })
})

describe('ONE labels map localizes every engine-written string (carve#1468)', () => {
  // The defect this closes: with a per-extension option as the ONLY spelling,
  // switching a document to German meant finding four separate call sites, and
  // missing one left an English name inside German prose with nothing to catch
  // it. PART 9 §16a forbids making the host configure the same text twice.
  const de = {
    footnoteBacklink: 'Zurück zur Referenz',
    indexBackref: 'Zurück zu',
    tabsGroup: 'Registerkarten',
    codeGroup: 'Codebeispiele',
  }

  it('reaches the index back-link', () => {
    const out = carveToHtml('A :index[Gerät] hier.\n\n::: index\n:::\n', {
      labels: de,
      extensions: [index()],
    })
    expect(out).toContain('aria-label="Zurück zu Gerät"')
  })

  it('reaches the tab set and the code group', () => {
    const tabs_ = carveToHtml(':::: tabs\n\n::: tab [Eins]\na\n:::\n\n::::\n', {
      labels: de,
      extensions: [tabs()],
    })
    expect(tabs_).toContain('aria-label="Registerkarten"')
    const group = carveToHtml('::: code-group\n\n``` php [PHP]\n1\n```\n\n:::\n', {
      labels: de,
      extensions: [codeGroup()],
    })
    expect(group).toContain('aria-label="Codebeispiele"')
  })

  it('lets the extension option override the map for one instance', () => {
    const out = carveToHtml(':::: tabs\n\n::: tab [Eins]\na\n:::\n\n::::\n', {
      labels: de,
      extensions: [tabs({ groupLabel: 'Explicit' })],
    })
    expect(out).toContain('aria-label="Explicit"')
    expect(out).not.toContain('aria-label="Registerkarten"')
  })
})

/*
 * THE OTHER HALF OF THE ADMISSION RULE (markup-carve/carve#1510, ruled in
 * markup-carve/carve#1520).
 *
 * The block above checks that a DOCUMENTED key reaches the output. This checks
 * the opposite direction. Extensions §1.5 used to say every extension-written
 * string with a fixed English default has a key in the `labels` map, and two
 * strings satisfied that sentence with no key: the heading-permalink label and
 * the table-of-contents summary. §1.5 has been narrowed instead of the map
 * grown - a string the extension already exposes as an OPTION is configured
 * there, and it does not get both spellings. PART 9 §16a's note recording the
 * question as open is now that rule.
 *
 * ASSERTING THE ABSENCE ALONE CANNOT FAIL FOR THE RIGHT REASON. A key nothing
 * implements is inert whether the rule is honored or the string was simply
 * forgotten, so each row asserts three things: the documented default renders,
 * the map key changes NOTHING, and the extension option DOES reach the output.
 * Only the third separates "configured elsewhere" from "not configurable at
 * all", which is the state §1.5 says a string must not be in.
 */
describe('a string its extension exposes as an option gets no labels key (carve#1510)', () => {
  interface OptionOnlyRow {
    source: string
    extension: (opts: Record<string, unknown>) => ReturnType<typeof headingPermalinks>
    option: (value: string) => Record<string, unknown>
    default: string
    find: (html: string) => string | undefined
  }

  const optionOnly: Record<string, OptionOnlyRow> = {
    headingPermalink: {
      source: '# One\n\nbody\n',
      extension: (opts) => headingPermalinks(opts),
      option: (value) => ({ ariaLabel: value }),
      default: 'Permalink',
      find: (html) => /class="permalink" aria-label="([^"]*)"/.exec(html)?.[1],
    },
    tocSummary: {
      source: '::: toc\n:::\n\n# One\n\nbody\n',
      extension: (opts) => tableOfContents({ collapsible: true, ...opts }),
      option: (value) => ({ summary: value }),
      default: 'Table of Contents',
      find: (html) => /<summary>([^<]*)<\/summary>/.exec(html)?.[1],
    },
  }

  for (const [key, row] of Object.entries(optionOnly)) {
    describe(key, () => {
      const render = (extensionOptions: Record<string, unknown>, renderOptions: object) =>
        row.find(
          carveToHtml(row.source, { extensions: [row.extension(extensionOptions)], ...renderOptions }),
        )

      it('renders the documented English default', () => {
        // Without this the two below could both hold on a probe that finds
        // nothing at all in either render.
        expect(render({}, {})).toBe(row.default)
      })

      it('is not read from the labels map', () => {
        expect(render({}, { labels: { [key]: `Sentinel-${key}` } })).toBe(row.default)
      })

      it('is read from the extension option', () => {
        expect(render(row.option(`Option-${key}`), {})).toBe(`Option-${key}`)
      })
    })
  }

  it('names neither string in the labels vocabulary', () => {
    // The assertion that fails if someone later adds the key the rule refuses.
    for (const key of Object.keys(optionOnly)) {
      expect(Object.keys(LABEL_DEFAULTS)).not.toContain(key)
    }
  })
})

/*
 * THE TABLE-OF-CONTENTS NAV SAYS WHAT IT IS CALLED (Extensions §8b.1,
 * markup-carve/carve#1547, ruling markup-carve/carve#1509).
 *
 * `<nav>` is a navigation landmark unconditionally - unlike `<section>`, which
 * maps to `generic` until it is named - so an unnamed one is an entry in a
 * reader's landmark list reading only "navigation". A page holds more than one
 * the moment both TOC extensions are registered, a document writes `::: toc`
 * twice, or a site template contributes its own, and unnamed they are
 * indistinguishable. That is the defect; a single anonymous nav is only how it
 * starts.
 *
 * AUTHORED, so it is a `labels` key rather than an extension option: the
 * directive's content is empty and nothing on the page names the nav, so there
 * is no string to derive from; `Table of contents` is ordinary English rather
 * than the class word `toc` an abbreviation-expanding reader would hear spelled
 * out; and no configuration put an `aria-label` on the nav in any engine, so
 * §1.5's "unless the extension already exposes it as an option" does not fire.
 */
describe('the table-of-contents nav carries its own name (carve#1509)', () => {
  const HEADINGS = '# One\n\n## Two\n\nbody\n'
  const PLACED = `::: toc\n:::\n\n${HEADINGS}`

  /** The `aria-label` on the `<nav>` SPECIFICALLY, whatever it says.
   *  Not a `toContain` on the whole document: every other named element in this
   *  file writes the same attribute, and the class is an option
   *  (`cssClass`/`css_class`), so neither the attribute alone nor the class
   *  string identifies the element under test. */
  const navLabel = (html: string): string | undefined =>
    /<nav\b[^>]*?\saria-label="([^"]*)"/.exec(html)?.[1]

  /*
   * THE THREE-ASSERTION STANDARD (markup-carve/carve#1511). A key is measured
   * by the documented default reaching the output, by the map entry CHANGING
   * it, and against a row for a key that already works - without which a probe
   * that finds nothing in either render satisfies the first two vacuously.
   */
  interface LabelRow {
    render: (options: object) => string
    probe: (html: string) => string | undefined
    default: string
  }

  const rows: Record<string, LabelRow> = {
    'tocNav (the ::: toc directive)': {
      render: (options) => carveToHtml(PLACED, { extensions: [tocPlacement()], ...options }),
      probe: navLabel,
      default: 'Table of contents',
    },
    'tocNav (the injected nav)': {
      render: (options) => carveToHtml(HEADINGS, { extensions: [tableOfContents()], ...options }),
      probe: navLabel,
      default: 'Table of contents',
    },
    // The control row: a key that was already read off this map before this
    // ruling, driven through the same three assertions by the same harness.
    'tabsGroup (the control)': {
      render: (options) =>
        carveToHtml(':::: tabs\n\n::: tab [One]\na\n:::\n\n::::\n', {
          extensions: [tabs()],
          ...options,
        }),
      probe: (html) => /<div class="tabs"[^>]*?\saria-label="([^"]*)"/.exec(html)?.[1],
      default: 'Tabs',
    },
  }

  for (const [name, row] of Object.entries(rows)) {
    describe(name, () => {
      it('renders the documented English default', () => {
        expect(row.probe(row.render({}))).toBe(row.default)
      })

      it('is read from the labels map', () => {
        const key = name.startsWith('tocNav') ? 'tocNav' : 'tabsGroup'
        expect(row.probe(row.render({ labels: { [key]: `Sentinel-${key}` } }))).toBe(
          `Sentinel-${key}`,
        )
      })
    })
  }

  it('declares the key with the documented default', () => {
    expect(LABEL_DEFAULTS.tocNav).toBe('Table of contents')
  })

  /*
   * §8b.3 makes the nav fragment the cross-impl contract, and naming it
   * per-extension is the one change that would break byte-identity between the
   * two extensions that write it.
   */
  it('gives both extensions the same nav, byte for byte', () => {
    const cut = (html: string) => html.slice(html.indexOf('<nav'), html.indexOf('</nav>') + 6)
    const placed = cut(carveToHtml(PLACED, { extensions: [tocPlacement()] }))
    const injected = cut(carveToHtml(HEADINGS, { extensions: [tableOfContents()] }))
    expect(placed).toBe(injected)
    expect(placed).toContain('aria-label="Table of contents"')

    const de = { labels: { tocNav: 'Inhaltsverzeichnis' } }
    expect(cut(carveToHtml(PLACED, { extensions: [tocPlacement()], ...de }))).toBe(
      cut(carveToHtml(HEADINGS, { extensions: [tableOfContents()], ...de })),
    )
  })

  /*
   * §8b.1 already carries the author's `{#id .class}` onto the nav, so an
   * authored name simply survives with nothing added beside it - §1.5's
   * existing precedence rather than a new rule. The match is on the attribute
   * NAME, case-insensitively (§16a, the shapes carve#1468 closed), and this
   * engine echoes the author's own spelling back, so a case-sensitive test
   * would write a second name next to theirs.
   */
  for (const spelling of ['aria-label', 'ARIA-LABEL', 'Aria-Label']) {
    it(`leaves an authored ${spelling} alone and adds nothing beside it`, () => {
      const out = carveToHtml(`{${spelling}="Chapters"}\n${PLACED}`, {
        extensions: [tocPlacement()],
      })
      expect(out).toContain(`${spelling}="Chapters"`)
      expect(out).not.toContain('Table of contents')
      expect(out.match(/aria-label=/gi)?.length).toBe(1)
    })
  }

  it('lets a host suppress the name entirely with an empty entry', () => {
    const out = carveToHtml(PLACED, { extensions: [tocPlacement()], labels: { tocNav: '' } })
    expect(out).toContain('<nav class="toc">')
    expect(navLabel(out)).toBeUndefined()
  })

  it('escapes a name carrying attribute-delimiting characters', () => {
    const out = carveToHtml(PLACED, {
      extensions: [tocPlacement()],
      labels: { tocNav: 'A "quoted" & <angled>' },
    })
    expect(navLabel(out)).toBe('A &quot;quoted&quot; &amp; &lt;angled&gt;')
  })

  /*
   * The DEGRADED nav is still a landmark. `::: toc` renders an empty `<nav>`
   * when no heading falls in its window, and again once the per-render byte
   * budget that bounds K blocks x N headings is exhausted. The budget bounds
   * the entry list, not the element's identity, so the name has to survive both
   * paths - and the empty one is exactly where an unnamed landmark is least
   * distinguishable, since there is no link text to read instead.
   */
  it('names an empty nav, which is still a landmark', () => {
    const out = carveToHtml('::: toc\n:::\n\nplain paragraph\n', { extensions: [tocPlacement()] })
    expect(out).toContain('<nav class="toc" aria-label="Table of contents"></nav>')
  })

  it('names the nav a budget exhaustion degraded', () => {
    let src = ''
    for (let i = 0; i < 5000; i++) src += '::: toc\n:::\n\n'
    for (let i = 0; i < 50; i++) src += `# Heading number ${i} with length\n\n`
    const out = carveToHtml(src, { extensions: [tocPlacement()] })
    // The budget IS reached - without this the assertion below passes on a
    // render where nothing degraded at all.
    expect(out).toContain('</nav>')
    const degraded = out.match(/<nav[^>]*><\/nav>/g) ?? []
    expect(degraded.length).toBeGreaterThan(0)
    for (const nav of degraded) expect(nav).toBe('<nav class="toc" aria-label="Table of contents"></nav>')
  })

  /*
   * NOTHING ELSE TAKES THE LABEL. `collapsible` renders `<details class="toc">`
   * with no `<nav>` at all, so the two strings sit on mutually exclusive
   * shapes: one is a landmark's accessible name, the other visible text in a
   * disclosure widget. That is what dissolves the apparent collision with the
   * near-identical `summary` default, which stays option-only (carve#1510).
   */
  it('does not name the disclosure shape, which has no nav to name', () => {
    const out = carveToHtml(HEADINGS, {
      extensions: [tableOfContents({ collapsible: true })],
      labels: { tocNav: 'Sentinel-tocNav' },
    })
    expect(out).toContain('<details class="toc">')
    expect(out).not.toContain('<nav')
    expect(out).not.toContain('Sentinel-tocNav')
    expect(out).toContain('<summary>Table of Contents</summary>')
  })

  it('leaves the summary reading from its own option, not from this key', () => {
    const summary = (html: string) => /<summary>([^<]*)<\/summary>/.exec(html)?.[1]
    const collapsible = (options: object) =>
      carveToHtml(HEADINGS, { extensions: [tableOfContents({ collapsible: true })], ...options })
    expect(summary(collapsible({ labels: { tocNav: 'Sentinel-tocNav' } }))).toBe(
      'Table of Contents',
    )
    expect(
      summary(
        carveToHtml(HEADINGS, {
          extensions: [tableOfContents({ collapsible: true, summary: 'Option-summary' })],
        }),
      ),
    ).toBe('Option-summary')
  })
})

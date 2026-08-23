import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { index } from '../src/index-terms.js'
import { tabs } from '../src/tabs.js'
import { codeGroup } from '../src/code-group.js'
import { mermaid, fencedRender } from '../src/fenced-render.js'
import { headingPermalinks } from '../src/heading-permalinks.js'
import { tableOfContents } from '../src/table-of-contents.js'
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

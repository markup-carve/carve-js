import { describe, expect, it } from 'vitest'
import { lint, parse, render, renderWithDiagnostics, renderWithDocumentTransforms, write } from '../../public/index.ts'
import {
  colorSwatch, defaultAttributes, details, inlineFootnotesToParentheses, isSmartQuoteLocaleSupported, listTable, semanticSpan,
  SMART_QUOTE_LOCALES, smartQuoteLocales, smartQuotes, spoiler, tabNormalize, wikilinks, withExtensions, type ExtensionBundle,
} from '../../public/extensions.ts'

/** The definitions and renderers of the bundles, spread into the options. */
function use(...bundles: ExtensionBundle[]) {
  const { extensions, renderers } = withExtensions(...bundles)
  return { extensions, renderers }
}

/** The document transforms of bundles. */
function transforms(...bundles: ExtensionBundle[]) {
  return withExtensions(...bundles).transforms ?? []
}

describe('details', () => {
  const options = use(details())

  it('renders a disclosure with the quoted title as summary', () => {
    expect(render('::: details "More info"\nHidden until expanded.\n:::\n', options)).toBe(
      '<details>\n  <summary>More info</summary>\n  <p>Hidden until expanded.</p>\n</details>')
  })

  it('defaults the summary and renders inline markup and escapes', () => {
    expect(render('::: details\nx\n:::\n', options)).toContain('<summary>Details</summary>')
    expect(render('::: details "a *b* <c>"\nx\n:::\n', options)).toContain('<summary>a <strong>b</strong> &lt;c&gt;</summary>')
  })

  it('carries block attributes onto the element and nests inside a list', () => {
    expect(render('{#faq .wide}\n::: details "Q"\nA\n:::\n', options)).toMatch(/^<details id="faq" class="wide">/)
    expect(render('- x\n\n  ::: details\n  a\n\n  b\n  :::\n', options)).toBe(
      '<ul>\n  <li>x\n    <details>\n      <summary>Details</summary>\n      <p>a</p>\n      <p>b</p>\n    </details>\n  </li>\n</ul>')
  })

  it('preserves fenced code text inside disclosures at every nesting depth', () => {
    const cases = [
      ['::: details "Req"\n```php\nx\n```\n:::\n', 'x\n'],
      ['::: details "Req"\n```php\nfirst\n  second\nthird\n```\n:::\n', 'first\n  second\nthird\n'],
      ['- item\n\n  ::: details "Req"\n  ```php\n  x\n  ```\n  :::', 'x\n'],
      ['- item\n\n  ::: details "Req"\n  ```php\n  first\n    second\n  third\n  ```\n  :::', 'first\n  second\nthird\n'],
      [':::: details "Outer"\n::: details "Req"\n```php\nx\n```\n:::\n::::', 'x\n'],
      [':::: details "Outer"\n::: details "Req"\n```php\nfirst\n  second\nthird\n```\n:::\n::::', 'first\n  second\nthird\n'],
    ] as const
    for (const [source, expected] of cases) {
      for (const mode of ['interactive', 'static'] as const) {
        const html = render(source, { ...options, mode })
        const code = html.match(/<pre><code class="language-php">([\s\S]*?)<\/code><\/pre>/)
        expect(code?.[1]).toBe(expected)
      }
    }
    expect(render(cases[0][0], options)).toBe(
      '<details>\n  <summary>Req</summary>\n  <pre><code class="language-php">x\n</code></pre>\n</details>')
  })

  it('writes the disclosure expanded in static mode, once', () => {
    expect(render('::: details\nx\n:::\n', { ...options, mode: 'static' })).toMatch(/^<details open>/)
    expect(render('{open}\n::: details\nx\n:::\n', { ...options, mode: 'static' })).toMatch(/^<details open="">/)
  })

  it('leaves admonitions and other divs alone', () => {
    expect(render('::: note\nx\n:::\n', options)).toContain('class="admonition note"')
    expect(render('::: other\nx\n:::\n', options)).toContain('<div class="other">')
  })

  it('stays a core div when the extension is not registered', () => {
    expect(render('::: details "T"\nx\n:::\n')).toBe('<div class="details">\n  <p class="admonition-title">T</p>\n  <p>x</p>\n</div>')
  })

  it('carries the claim as a qualified node that writes back to its source', () => {
    const source = '::: details "T"\nx\n:::\n'
    const node = parse(source, { extensions: details().extensions }).children[0]
    expect(node).toMatchObject({ type: 'block_extension', name: 'carve.details', source: { form: 'div', name: 'details', title: 'T' } })
    const { extensions } = details()
    expect(write(parse(source, { extensions, positions: false }), { extensions })).toBe(source)
  })

  it('renders the title and body as core content with only the definition (C2-X-035)', () => {
    const { extensions } = details()
    const result = renderWithDiagnostics(parse('::: details "T"\nx\n:::\n', { extensions }), { extensions })
    expect(result.html).toBe('<p><strong>T</strong></p>\n<p>x</p>')
    expect(result.diagnostics.map((entry) => entry.code)).toContain('extension-fallback-rendered')
  })
})

describe('spoiler', () => {
  const options = use(spoiler())

  it('renders the inline form as a span and merges author classes', () => {
    expect(render('Plot: :spoiler[the butler]{.x onclick="a()"}.', options)).toBe(
      '<p>Plot: <span class="spoiler x">the butler</span>.</p>')
  })

  it('renders the block form as a disclosure with a default summary', () => {
    expect(render('::: spoiler "Ending"\nEveryone lives.\n:::\n', options)).toBe(
      '<details class="spoiler">\n  <summary>Ending</summary>\n  <p>Everyone lives.</p>\n</details>')
    expect(render('::: spoiler\nx\n:::\n', options)).toContain('<summary>Spoiler</summary>')
  })

  it('reveals both forms in static mode', () => {
    expect(render(':spoiler[x]', { ...options, mode: 'static' })).toBe('<p><span class="spoiler spoiler-revealed">x</span></p>')
    expect(render('::: spoiler "E"\nx\n:::\n', { ...options, mode: 'static' })).toBe(
      '<section class="spoiler spoiler-revealed">\n  <h3 class="spoiler-title">E</h3>\n  <p>x</p>\n</section>')
  })

  it('preserves fenced code text in a static spoiler', () => {
    const html = render('::: spoiler "Example"\n```php\nfirst\n  second\n```\n:::\n',
      { ...use(spoiler()), mode: 'static' })
    expect(html).toContain('<pre><code class="language-php">first\n  second\n</code></pre>')
  })

  it('keeps the core forms without the extension', () => {
    expect(render(':spoiler[x]')).toBe('<p><span class="ext-spoiler">x</span></p>')
    expect(render('::: spoiler\nx\n:::\n')).toBe('<div class="spoiler">\n  <p>x</p>\n</div>')
  })
})

describe('raw HTML in a disclosure body (carve-js#5637)', () => {
  const raw = (prefix: string) => ['```=html', '<div>', '  x', '</div>', '```'].map((text) => prefix + text).join('\n')
  const cases = [
    ['details', use(details())], ['spoiler', use(spoiler())],
  ] as const

  it('writes the raw lines byte exact at their own column (C2-H-134)', () => {
    const options = { ...use(details()), rawHtml: true }
    expect(render(`::: details "R"\n${raw('')}\n:::\n`, options)).toBe(
      '<details>\n  <summary>R</summary>\n<div>\n  x\n</div>\n</details>')
    expect(render(`- a\n\n  ::: details "R"\n${raw('  ')}\n  :::\n`, options)).toBe(
      '<ul>\n  <li>a\n    <details>\n      <summary>R</summary>\n<div>\n  x\n</div>\n    </details>\n  </li>\n</ul>')
  })

  for (const [name, bundle] of cases) {
    for (const mode of ['interactive', 'static'] as const) {
      for (const [prefix, open, close] of [['', '', ''], ['  ', '- a\n\n', ''], ['> ', '', ''], ['    ', '- a\n\n  - b\n\n', '']] as const) {
        it(`keeps every raw line in ${name} (${mode}, prefix ${JSON.stringify(prefix)})`, () => {
          const fence = prefix + `::: ${name} "R"`
          const html = render(`${open}${fence}\n${raw(prefix)}\n${prefix}after\n${prefix}:::\n${close}`, { ...bundle, mode, rawHtml: true })
          expect(html).toContain('\n<div>\n  x\n</div>\n')
        })
      }
    }
  }
})

describe('semanticSpan', () => {
  it('renders the four added keys in the 0.1 nesting order', () => {
    const options = use(semanticSpan())
    expect(render('[x]{samp} [y]{var} [z]{cite} [w]{dfn=term}', options)).toBe(
      '<p><samp>x</samp> <var>y</var> <cite>z</cite> <dfn title="term">w</dfn></p>')
    expect(render('[x]{kbd samp}', options)).toBe('<p><kbd><samp>x</samp></kbd></p>')
    expect(render('[x]{samp}')).toBe('<p><span samp="">x</span></p>')
  })

  it('makes lint report the added keys outside a span (carve-js#5060)', () => {
    const codes = (options?: Parameters<typeof lint>[1]) => lint('{samp}\nOutput text.\n', options).map((entry) => entry.code)
    const { extensions } = semanticSpan()
    expect(codes({ extensions })).toEqual(['semantic-attribute-outside-span'])
    expect(codes()).toEqual([])
    expect(lint('[x]{samp=1}\n', { extensions }).map((entry) => entry.code)).toEqual(['semantic-attribute-value-ignored'])
  })
})

describe('wikilinks', () => {
  it('links the target through a slug with the anchor appended', () => {
    expect(render(':wiki[Main Page#top]', use(wikilinks()))).toBe(
      '<p><a href="main-page#top" class="wikilink" data-wikilink="Main Page">Main Page</a></p>')
    expect(render(':wiki[docs/Install Guide|the guide]', use(wikilinks()))).toBe(
      '<p><a href="docs/install-guide" class="wikilink" data-wikilink="docs/Install Guide">the guide</a></p>')
  })

  it('honors the options and the URL policy', () => {
    const options = use(wikilinks({ urlGenerator: (page) => `/w/${page}`, cssClass: 'a b', newWindow: true }))
    expect(render(':wiki[P]', options)).toBe(
      '<p><a href="/w/P" class="a b" data-wikilink="P" target="_blank" rel="noopener">P</a></p>')
    expect(render(':wiki[P]{rel=opener TARGET=x data-wikilink=y HREF=/evil lang=de}', options)).toBe(
      '<p><a href="/w/P" class="a b" data-wikilink="P" lang="de" target="_blank" rel="noopener">P</a></p>')
    expect(render(':wiki[P]', use(wikilinks({ urlGenerator: () => 'javascript:alert(1)' })))).toBe('<p>P</p>')
  })

  it('is the one :wiki implementation: without a renderer it is the core text fallback', () => {
    expect(render(':wiki[P]')).toBe('<p><span class="ext-wiki">P</span></p>')
    expect(parse(':wiki[P]', { extensions: wikilinks().extensions, positions: false }).children[0]).toMatchObject({
      children: [{ type: 'inline_extension', name: 'carve.wiki' }] })
  })
})

describe('smartQuotes', () => {
  it('writes the locale quotes and leaves apostrophes', () => {
    const options = use(smartQuotes({ locale: 'de' }))
    expect(render('"Hi" it\'s \'x\'', { ...options, smartTypography: true })).toBe('<p>„Hi“ it’s ‚x‘</p>')
    expect(render('"Hi"', { ...options, smartTypography: false })).toBe('<p>"Hi"</p>')
  })

  it('uses the exact locale, then its language, then English, and partial overrides', () => {
    expect(render('"a"', { ...use(smartQuotes({ locale: 'de_CH' })), smartTypography: true })).toBe('<p>«a»</p>')
    expect(render('"a"', { ...use(smartQuotes({ locale: 'fr-CA' })), smartTypography: true })).toBe('<p>«&nbsp;a&nbsp;»</p>')
    expect(render('"a"', { ...use(smartQuotes({ locale: 'xx' })), smartTypography: true })).toBe('<p>“a”</p>')
    expect(render('"a"', { ...use(smartQuotes({ closeDoubleQuote: '!' })), smartTypography: true })).toBe('<p>“a!</p>')
  })

  it('lists the supported locales', () => {
    expect(smartQuoteLocales()).toEqual(Object.keys(SMART_QUOTE_LOCALES))
    expect(isSmartQuoteLocaleSupported('de-AT')).toBe(true)
    expect(isSmartQuoteLocaleSupported('xx')).toBe(false)
  })

  it('reads only own locale keys, so a prototype name falls back to English (carve-rs#4838)', () => {
    for (const locale of ['constructor', 'toString', '__proto__', 'hasOwnProperty-x']) {
      expect([locale, render('"a"', { ...use(smartQuotes({ locale })), smartTypography: true })]).toEqual([locale, '<p>“a”</p>'])
      expect([locale, isSmartQuoteLocaleSupported(locale)]).toEqual([locale, false])
    }
  })
})

describe('listTable and colorSwatch', () => {
  it('render in both channels from the one registration', () => {
    const source = '::: list-table\n- - a\n  - b\n:::\n'
    const html = render(source, use(listTable()))
    expect(html).toContain('<table>')
    expect(render(source, { ...use(listTable()), mode: 'static' })).toBe(html)
    expect(render(':color[#f00]', { ...use(colorSwatch()), mode: 'static' })).toContain('swatch-chip')
    expect(render(':color[#f00]', use(colorSwatch({ position: 'none' })))).toContain('swatch-chip-only')
  })
})

describe('document transforms', () => {
  it('applies default attributes under the authored ones', () => {
    const bundle = defaultAttributes({ heading: { class: 'h', id: 'x', 'data-a': '1' }, code_block: { class: 'c' } })
    const result = renderWithDocumentTransforms('{#own data-a=2}\n# H\n\n```\nx\n```\n', transforms(bundle), { sections: false })
    expect(result.html).toBe('<h1 id="own" class="h" data-a="2">H</h1>\n<pre class="c"><code>x\n</code></pre>')
  })

  it('normalizes tabs in code only', () => {
    const html = renderWithDocumentTransforms('a\tb `c\td`\n\n```\n\tx\n```\n', transforms(tabNormalize(4))).html
    expect(html).toBe('<p>a\tb <code>c    d</code></p>\n<pre><code>    x\n</code></pre>')
    expect(renderWithDocumentTransforms('```\n\tx\n```\n', transforms(tabNormalize())).html).toBe('<pre><code>  x\n</code></pre>')
    expect(() => tabNormalize(-1)).toThrow(RangeError)
  })

  it('writes inline footnotes in parentheses', () => {
    expect(renderWithDocumentTransforms('a^[two *b*] c\n', transforms(inlineFootnotesToParentheses())).html).toBe(
      '<p>a (two <strong>b</strong>) c</p>')
  })

  it('leaves the authored tree alone', () => {
    const tree = parse('a^[n]\n')
    const before = JSON.stringify(tree)
    renderWithDocumentTransforms(tree, transforms(inlineFootnotesToParentheses()))
    expect(JSON.stringify(tree)).toBe(before)
  })
})

describe('registration', () => {
  it('lets a host replace a bundled renderer', () => {
    const { extensions, renderers } = use(details())
    expect(render('::: details\nx\n:::\n', { extensions, renderers: { ...renderers, 'carve.details': { version: '1', render: () => '<x>' } } }))
      .toBe('<x>')
  })

  it('refuses invalid host fields', () => {
    const bad = (entry: object) => () => render('a', { extensions: [{ name: 'a.b', version: '1', props: {}, slots: {}, ...entry }] })
    expect(bad({ semanticKeys: [['samp', null]] })).toThrow(/semantic keys/)
    expect(bad({ quotes: ['a'] })).toThrow(/quotes/)
  })
})

describe('authored keys on extension elements (carve-js#5647, C2-H-161)', () => {
  it('writes a value with a denied scheme empty, as on a core element', () => {
    const options = use(wikilinks(), spoiler())
    expect(render('X :wiki[Page]{title="javascript:x"} Y\n\nZ :spoiler[s]{title="javascript:x"}\n\n*c*{title="javascript:x"}\n', options)).toBe(
      '<p>X <a href="page" class="wikilink" data-wikilink="Page" title="">Page</a> Y</p>\n'
      + '<p>Z <span class="spoiler" title="">s</span></p>\n<p><strong title="">c</strong></p>')
  })

  it('tests every authored key, and keeps a value without a denied scheme', () => {
    const options = use(wikilinks(), details())
    expect(render(':wiki[P]{data-x="vbscript:y" title="a: b"}\n', options))
      .toBe('<p><a href="p" class="wikilink" data-wikilink="P" data-x="" title="a: b">P</a></p>')
    expect(render('{title="JavaScript:x" lang="en"}\n::: details\nx\n:::\n', options)).toMatch(/^<details title="" lang="en">/)
  })
})

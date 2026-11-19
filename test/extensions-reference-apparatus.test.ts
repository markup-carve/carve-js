import { describe, expect, it } from 'vitest'
import { parse, render, renderWithDocumentTransforms, type RenderOptions } from '../src/index.ts'
import { type ExtensionBundle, withExtensions } from '../src/extensions/standard/bundle.ts'
import { citations, citeExtension } from '../src/extensions/citations.ts'
import { glossary } from '../src/extensions/glossary.ts'
import { index } from '../src/extensions/index-terms.ts'

function html(source: string, bundle: ExtensionBundle, options: RenderOptions = {}): string {
  const result = renderWithDocumentTransforms(source, bundle.transforms ?? [],
    { ...options, extensions: bundle.extensions, renderers: bundle.renderers })
  expect(result.diagnostics.filter((entry) => entry.code.startsWith('extension-'))).toEqual([])
  return result.html
}

const GLOSS = '::: glossary\n:: HTTP\n: HyperText Transfer Protocol.\n\n:: HTML\n: HyperText Markup Language.\n:::\n'

describe('glossary', () => {
  it('gives each entry a gloss- id and writes the lists with the class glossary', () => {
    expect(html(GLOSS, glossary())).toBe([
      '<div class="glossary">',
      '  <dl class="glossary">',
      '    <dt id="gloss-HTTP">HTTP</dt>',
      '    <dd>HyperText Transfer Protocol.</dd>',
      '    <dt id="gloss-HTML">HTML</dt>',
      '    <dd>HyperText Markup Language.</dd>',
      '  </dl>',
      '</div>',
    ].join('\n'))
  })

  it('links :term[word] to its entry and writes an undefined term as a span', () => {
    const out = html(`Use :term[HTTP] and :term[FTP].\n\n${GLOSS}`, glossary())
    expect(out).toContain('<a href="#gloss-HTTP" class="term">HTTP</a>')
    expect(out).toContain('<span class="term">FTP</span>')
  })

  it('matches exactly, with case, after whitespace collapse and NFC', () => {
    const out = html('Use :term[http], :term[Hyper  Text] and :term[Café].\n\n::: glossary\n:: HTTP\n: Up.\n\n' +
      ':: Hyper Text\n: One.\n\n:: Café\n: Two.\n:::\n', glossary())
    expect(out).toContain('<span class="term">http</span>')
    expect(out).toContain('<a href="#gloss-Hyper-Text" class="term">Hyper  Text</a>')
    expect(out).toContain('<a href="#gloss-Café" class="term">Café</a>')
  })

  it('gives the id to the first of a duplicated slug only', () => {
    const out = html('::: glossary\n:: HTTP\n: One.\n\n:: HTTP\n: Two.\n:::\n', glossary())
    expect(out.match(/id="gloss-HTTP"/gu)).toHaveLength(1)
    expect(out).toContain('<dt>HTTP</dt>')
  })

  it('keeps the authored attributes of the use and drops an authored href', () => {
    const out = html(`Use :term[HTTP]{.abbr #use HREF="#other"}.\n\n${GLOSS}`, glossary())
    expect(out).toContain('<a href="#gloss-HTTP" id="use" class="term abbr">HTTP</a>')
  })

  it('keeps title, intro and trailing blocks in order, and the authored attributes on the directive', () => {
    const out = html('{#terms .wide}\n::: glossary "Terms"\nIntro.\n\n:: HTTP\n: One.\n\nSee the RFCs.\n:::\n', glossary())
    expect(out).toMatch(/^<div id="terms" class="glossary wide">\n {2}<p class="admonition-title">Terms<\/p>\n {2}<p>Intro.<\/p>/u)
    expect(out.indexOf('gloss-HTTP')).toBeLessThan(out.indexOf('See the RFCs.'))
  })

  it('finds a glossary inside a quote and links uses inside entries', () => {
    const out = html('Use :term[HTTP].\n\n> ::: glossary\n> :: HTTP\n> : Uses :term[HTML].\n>\n> :: HTML\n> : Markup.\n> :::\n',
      glossary())
    expect(out).toContain('<dt id="gloss-HTTP">HTTP</dt>')
    expect(out).toContain('<a href="#gloss-HTML" class="term">HTML</a>')
  })

  it('does not take an authored id', () => {
    const out = html(`[x]{#gloss-HTTP} :term[HTTP]\n\n${GLOSS}`, glossary())
    expect(out).toContain('<dt id="gloss-HTTP-2">HTTP</dt>')
    expect(out).toContain('<a href="#gloss-HTTP-2" class="term">HTTP</a>')
  })

  it('writes the same HTML with the build-time renderer', () => {
    const source = `Use :term[HTTP].\n\n${GLOSS}`
    expect(html(source, glossary(), { mode: 'static' })).toBe(html(source, glossary()))
  })

  it('keeps the core reading when it is not registered', () => {
    expect(render(`Use :term[HTTP].\n\n${GLOSS}`)).toBe([
      '<p>Use <span class="ext-term">HTTP</span>.</p>',
      '<div class="glossary">',
      '  <dl>',
      '    <dt>HTTP</dt>',
      '    <dd>HyperText Transfer Protocol.</dd>',
      '    <dt>HTML</dt>',
      '    <dd>HyperText Markup Language.</dd>',
      '  </dl>',
      '</div>',
    ].join('\n'))
  })

  it('writes the fallback with the matcher alone', () => {
    const bundle = glossary()
    expect(render('Use :term[HTTP]{.abbr}.', { extensions: bundle.extensions })).toBe('<p>Use <span class="abbr">HTTP</span>.</p>')
  })

  it('leaves the authored tree as it was', () => {
    const bundle = glossary()
    const tree = parse(`Use :term[HTTP].\n\n${GLOSS}`, { extensions: bundle.extensions })
    const before = JSON.stringify(tree)
    renderWithDocumentTransforms(tree, bundle.transforms ?? [], { extensions: bundle.extensions, renderers: bundle.renderers })
    expect(JSON.stringify(tree)).toBe(before)
  })
})

describe('index', () => {
  const SOURCE = 'A :index[Widget]widget, :index[gadget] and :index[widget].\n\n::: index "Index"\n:::\n'

  it('writes invisible markers and a sorted list with one back-link per use', () => {
    expect(html(SOURCE, index())).toBe([
      '<p>A <span id="idx-widget-1" class="index-term"></span>widget, <span id="idx-gadget-1" class="index-term"></span> and ' +
        '<span id="idx-widget-2" class="index-term"></span>.</p>',
      '<div class="index">',
      '  <p class="admonition-title">Index</p>',
      '  <ul class="index">',
      '    <li>gadget <a href="#idx-gadget-1" class="index-backref" aria-label="Back to gadget">↩</a></li>',
      '    <li>Widget <a href="#idx-widget-1" class="index-backref" aria-label="Back to Widget 1">↩<sup>1</sup></a> ' +
        '<a href="#idx-widget-2" class="index-backref" aria-label="Back to Widget 2">↩<sup>2</sup></a></li>',
      '  </ul>',
      '</div>',
    ].join('\n'))
  })

  it('sorts by code point, not by locale', () => {
    const out = html(':index[b] :index[B] :index[ä] :index[a]\n\n::: index\n:::\n', index())
    const order = [...out.matchAll(/<li>(\S+) /gu)].map((match) => match[1])
    expect(order).toEqual(['a', 'b', 'ä'])
  })

  it('takes the back-link label from the option', () => {
    expect(html(':index[x]\n\n::: index\n:::\n', index({ backrefLabel: 'Zurück zu' }))).toContain('aria-label="Zurück zu x"')
  })

  it('does not count a marker in a note', () => {
    const out = html('A :index[x].[^n]\n\n[^n]: Note :index[x].\n\n::: index\n:::\n', index())
    expect(out).toContain('<p>Note <span class="index-term"></span>.')
    expect(out).not.toContain('idx-x-2')
  })

  it('keeps authored blocks before the list and the authored attributes on the directive', () => {
    const out = html(':index[x]\n\n{#ix .wide}\n::: index\nSee also.\n:::\n', index())
    expect(out).toMatch(/<div id="ix" class="index wide">\n {2}<p>See also.<\/p>\n {2}<ul class="index">/u)
  })

  it('leaves an index directive without markers as core', () => {
    expect(html('::: index\n:::\n', index())).toBe(render('::: index\n:::\n'))
  })

  it('writes the same HTML with the build-time renderer', () => {
    expect(html(SOURCE, index(), { mode: 'static' })).toBe(html(SOURCE, index()))
  })

  it('keeps the core reading when it is not registered, and hides the marker with the matcher alone', () => {
    expect(render('A :index[x].')).toBe('<p>A <span class="ext-index">x</span>.</p>')
    expect(render('A :index[x].', { extensions: index().extensions })).toBe('<p>A .</p>')
  })

  it('charges a long back-link label to the cap', () => {
    const markers = Array.from({ length: 3000 }, () => ':index[x]').join(' ')
    const out = html(`${markers}\n\n::: index\n:::\n`, index({ backrefLabel: 'L'.repeat(500) }))
    expect(new TextEncoder().encode(out).length).toBeLessThan(1_500_000)
  })

  it('caps the output of repeated index directives', () => {
    const markers = Array.from({ length: 2000 }, (_, at) => `:index[term${at}]`).join(' ')
    const out = html(`${markers}\n\n${'::: index\n:::\n\n'.repeat(20)}`, index())
    expect(new TextEncoder().encode(out).length).toBeLessThan(1_500_000)
  })
})

const REFS = '::: references "References"\n:: doe\n: Doe, J. (2020). /A book/.\n\n:: roe\n: Roe, R. (2019). Paper.\n:::\n'

describe('citations', () => {
  it('numbers citations by definition order and lists every entry in source order (C2-X-058)', () => {
    expect(html(`See :cite[roe] and :cite[doe; roe]{locator="p. 4"}.\n\n${REFS}`, citations())).toBe([
      '<p>See [<a href="#ref-roe" data-cite-key="roe">2</a>] and [<a href="#ref-doe" data-cite-key="doe">1</a>, ' +
        '<a href="#ref-roe" data-cite-key="roe">2</a>, p. 4].</p>',
      '<div class="references">',
      '  <p class="admonition-title">References</p>',
      '  <ol class="references">',
      '    <li id="ref-doe">Doe, J. (2020). <em>A book</em>.</li>',
      '    <li id="ref-roe">Roe, R. (2019). Paper.</li>',
      '  </ol>',
      '</div>',
    ].join('\n'))
  })

  it('keeps an uncited definition in the claimed directive (C2-X-058)', () => {
    const out = html(`See :cite[doe].\n\n${REFS}`, citations())
    expect(out).toContain('<li id="ref-doe">Doe, J. (2020). <em>A book</em>.</li>')
    expect(out).toContain('<li id="ref-roe">Roe, R. (2019). Paper.</li>')
  })

  it('renders each claimed directive from its own definitions without citation uses', () => {
    const source = '::: references\n:: z\n: Last.\n\n:: a\n: First.\n:::\n\n::: bibliography\n:: b\n: Other.\n:::\n'
    const out = html(source, citations({ mode: 'author-date' }))
    expect(out.indexOf('id="ref-z"')).toBeLessThan(out.indexOf('id="ref-a"'))
    expect(out.indexOf('id="ref-a"')).toBeLessThan(out.indexOf('id="ref-b"'))
    expect(out.match(/<ul class="references">/gu)).toHaveLength(2)
  })

  it('writes an undefined key as its text and gives it no number', () => {
    const out = html(`:cite[nope] :cite[doe; nope] :cite[doe]\n\n${REFS}`, citations())
    expect(out).toContain('<p>nope doe; nope [<a href="#ref-doe" data-cite-key="doe">1</a>]</p>')
  })

  it('writes author-date labels from the attributes of the key', () => {
    const source = 'See :cite[doe] and :cite[doe]{mode="suppress-author"}.\n\n::: bibliography\n' +
      ':: [doe]{author="Doe" year="2020"}\n: Doe, J. A book.\n:::\n'
    const out = html(source, citations({ mode: 'author-date' }))
    expect(out).toContain('<p>See (<a href="#ref-doe" data-cite-key="doe">Doe 2020</a>) and (<a href="#ref-doe" ' +
      'data-cite-key="doe">2020</a>).</p>')
    expect(out).toContain('<ul class="references">')
  })

  it('marks an integral citation and keeps attributes of its own', () => {
    const out = html(`:cite[doe]{mode="author-in-text"} :cite[doe]{#c .x prefix="see"}\n\n${REFS}`, citations())
    expect(out).toContain('<span class="citation" data-cite-mode="integral">[<a href="#ref-doe" data-cite-key="doe">1</a>]</span>')
    expect(out).toContain('<span id="c" class="citation x">[see <a href="#ref-doe" data-cite-key="doe">1</a>]</span>')
  })

  it('numbers citations in notes after the body', () => {
    const out = html(`A :cite[roe].[^n] B :cite[doe].\n\n[^n]: :cite[roe] again.\n\n${REFS}`, citations())
    expect(out).toContain('B [<a href="#ref-doe" data-cite-key="doe">1</a>]')
  })

  it('numbers citations in inline notes after the body', () => {
    const out = html(`A^[see :cite[roe]] B :cite[doe].\n\n${REFS}`, citations())
    expect(out).toContain('B [<a href="#ref-doe" data-cite-key="doe">1</a>]')
  })

  it('resolves from a CSL-JSON pool with back-links, the document entry first', () => {
    const bundle = citations({ bibliography: [
      { id: 'doe', title: 'Ignored' },
      { id: 'smith', author: [{ family: 'Smith', given: 'A.' }, { literal: 'ACME' }], issued: { 'date-parts': [[2001]] }, title: 'T' },
    ] })
    const out = html(`:cite[doe] :cite[smith] :cite[doe]\n\n${REFS}`, bundle)
    expect(out).toContain('<a id="cite-doe-1" href="#ref-doe" data-cite-key="doe">1</a>')
    expect(out).toContain('<li id="ref-doe">Doe, J. (2020). <em>A book</em>. <a href="#cite-doe-1" class="ref-backref">↩</a> ' +
      '<a href="#cite-doe-2" class="ref-backref">↩</a></li>')
    expect(out).toContain('<li id="ref-smith">Smith, A.; ACME (2001). T. <a href="#cite-smith-1" class="ref-backref">↩</a></li>')
  })

  it('appends the list at the end without a directive, and reads untrusted CSL-JSON safely', () => {
    const bundle = citations({ bibliography: [{ id: 'x', author: 'nobody' as never, title: '<b>' }] })
    expect(html('A :cite[x].', bundle)).toBe([
      '<p>A [<a id="cite-x-1" href="#ref-x" data-cite-key="x">1</a>].</p>',
      '<ol class="references">',
      '  <li id="ref-x">&lt;b&gt;. <a href="#cite-x-1" class="ref-backref">↩</a></li>',
      '</ol>',
    ].join('\n'))
  })

  it('writes the same HTML with the build-time renderer', () => {
    const source = `See :cite[doe].\n\n${REFS}`
    expect(html(source, citations(), { mode: 'static' })).toBe(html(source, citations()))
  })

  it('keeps the core reading when it is not registered, and the key text with the matcher alone (C2-X-058)', () => {
    expect(render(':cite[doe]\n')).toBe('<p><span class="ext-cite">doe</span></p>')
    expect(render(':cite[doe]\n', { extensions: [citeExtension] })).toBe('<p>doe</p>')
  })
})

describe('withExtensions', () => {
  it('registers several bundles at once', () => {
    const all = withExtensions(glossary(), index(), citations())
    const result = renderWithDocumentTransforms(`:term[HTTP] :index[x] :cite[doe]\n\n${GLOSS}\n::: index\n:::\n\n${REFS}`,
      all.transforms ?? [], { extensions: all.extensions, renderers: all.renderers })
    expect(result.html).toContain('href="#gloss-HTTP"')
    expect(result.html).toContain('id="idx-x-1"')
    expect(result.html).toContain('href="#ref-doe"')
  })
})

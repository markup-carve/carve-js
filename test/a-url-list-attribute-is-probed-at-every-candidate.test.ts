import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { renderedAttrValue, DANGEROUS_URL_SCHEMES } from '../src/render-html.js'

/**
 * PART 9 §25, the URL-list half of the attribute-value probe.
 *
 * The probe read the value's LEADING scheme, which vouches for the whole value
 * only where the whole value is ONE URL. Four attributes carry a LIST of them,
 * so the SAME value got two answers depending on where the scheme sat
 * (markup-carve/carve#1320):
 *
 *     ![a](safe.png){srcset="javascript:alert(1) 1x, safe.png 2x"}
 *
 *     ![a](safe.png){srcset="safe.png 1x, javascript:alert(1) 2x"}
 *
 * rendered
 *
 *     <img src="safe.png" alt="a" srcset="">
 *     <img src="safe.png" alt="a" srcset="safe.png 1x, javascript:alert(1) 2x">
 *
 * THIS IS NOT A BROWSER XSS and must not be filed as one: a browser does not
 * navigate `javascript:` in an image context and pings http(s) only. What was
 * wrong is that the defense was positionally inconsistent, and that the clause
 * stated a guarantee it did not keep for the consumers of Carve's HTML that are
 * not browsers - feed readers, mail renderers, image pipelines, a scraper
 * picking the highest-density candidate. `ping` is the one that matters most,
 * because a user agent really does fetch every URL in it.
 *
 * THIS FILE ASSERTS BOTH DIRECTIONS, and the second direction is the load
 * bearing one. A dangerous scheme in a non-leading token is refused, AND a
 * legitimate prose value carrying a colon is not. `title`, `alt` and
 * `aria-label` carry colons routinely, so a blanket "any token that looks like
 * a scheme" test would refuse ordinary text - the false-positive bound is what
 * decides the rule's shape, and it is what stops the next person loosening this
 * when it fires spuriously.
 *
 * Note the HTML IMPORT path already refused these shapes
 * (markup-carve/carve-js#1157). That is the importer declining to ADMIT an
 * attribute. This is the RENDERER, and what it protects is hand-written Carve.
 */

const NBSP_NARROW = ' ' // stripped by the probe, NOT a split boundary
const ZWSP = '​' // Cf: left alone at every position, by decision
const attr = (html: string, name: string) =>
  new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null
const img = (block: string) => carveToHtml(`![a](safe.png){${block}}\n`)
const link = (block: string) => carveToHtml(`[y](safe.html){${block}}\n`)

/** The four names and the separator each one's own grammar uses. */
const COMMA_SPLIT = ['srcset', 'imagesrcset'] as const
const SPACE_SPLIT = ['ping', 'attributionsrc'] as const
const URL_LIST = [...COMMA_SPLIT, ...SPACE_SPLIT]

describe('a URL-list attribute is probed at every candidate', () => {
  it('CONTROL: the leading position was always blanked, and still is', () => {
    // The denylist itself was never broken - only the non-leading position got
    // past - so no mutation of this defect may move this row. If it goes red,
    // the failure is in the denylist and this file is looking at the wrong
    // thing.
    for (const name of URL_LIST) {
      expect(renderedAttrValue(name, 'javascript:alert(1) safe.png'), name).toBe('')
    }
    expect(attr(img('srcset="javascript:alert(1) 1x, safe.png 2x"'), 'srcset')).toBe('')
    expect(attr(link('ping="javascript:alert(1) safe.html"'), 'ping')).toBe('')
  })

  it('THE FIX: a non-leading candidate is refused, on each of the four names', () => {
    // Per name, so a survivor cannot hide behind a sibling: with four
    // attributes and two separator rules, the plausible mutant is one name
    // whose test never actually reaches it.
    for (const name of COMMA_SPLIT) {
      expect(renderedAttrValue(name, 'safe.png 1x, javascript:alert(1) 2x'), name).toBe('')
    }
    for (const name of SPACE_SPLIT) {
      expect(renderedAttrValue(name, 'https://example.com/s javascript:alert(1)'), name).toBe('')
    }
    // And end to end, through the renderer rather than through the seam.
    expect(attr(img('srcset="safe.png 1x, javascript:alert(1) 2x"'), 'srcset')).toBe('')
    expect(attr(img('imagesrcset="safe.png 1x, javascript:alert(1) 2x"'), 'imagesrcset')).toBe('')
    expect(attr(link('ping="safe.html javascript:alert(1)"'), 'ping')).toBe('')
    expect(
      attr(link('attributionsrc="https://example.com/s javascript:alert(1)"'), 'attributionsrc'),
    ).toBe('')
  })

  it('what is blanked is the WHOLE value, not the offending candidate', () => {
    // Excising the candidate would make the rendered attribute differ from the
    // author's bytes, which this clause already declined to do (carve#782), and
    // it would give one value a THIRD outcome when the defect being fixed is
    // that one value already had two.
    const out = attr(img('srcset="safe.png 1x, javascript:alert(1) 2x"'), 'srcset')
    expect(out).toBe('')
    expect(out).not.toContain('safe.png')
  })

  it('it is the whole denylist, not the script schemes', () => {
    // The OS protocol-handler class (CVE-2026-20841) hides in a non-leading
    // candidate exactly as well, and a fix that only reached `javascript` would
    // be half a fix twice over.
    for (const scheme of DANGEROUS_URL_SCHEMES) {
      expect(renderedAttrValue('ping', `safe.html ${scheme}:payload`), scheme).toBe('')
      expect(renderedAttrValue('srcset', `safe.png 1x, ${scheme}:payload 2x`), scheme).toBe('')
    }
  })

  it('the separators differ per attribute, and that is the rule', () => {
    // A COMMA ENDS A CANDIDATE for srcset/imagesrcset, so a whitespace-only
    // split misses this outright: one absent space after the comma and the
    // second candidate hides inside the first one's descriptor.
    for (const name of COMMA_SPLIT) {
      expect(renderedAttrValue(name, 'safe.png 1x,javascript:alert(1) 2x'), name).toBe('')
    }
    expect(attr(img('srcset="safe.png 1x,javascript:alert(1) 2x"'), 'srcset')).toBe('')

    // A COMMA IS ORDINARY PATH TEXT for ping/attributionsrc, whose grammars
    // hold no comma at all. Splitting on one would blank a single legitimate
    // URL, which is a false positive and the thing this rule may not do.
    for (const name of SPACE_SPLIT) {
      expect(renderedAttrValue(name, 'https://example.com/a,data:x'), name).toBe(
        'https://example.com/a,data:x',
      )
    }
    expect(attr(link('ping="https://example.com/a,data:x"'), 'ping')).toBe(
      'https://example.com/a,data:x',
    )
  })

  it('the comma split OVER-BLANKS one srcset shape, and that is the chosen side', () => {
    // `https://example.com/a,data:x 1x` is ONE candidate to a consumer and is
    // blanked here anyway. Reading it exactly would take the HTML candidate-list
    // algorithm, descriptor scan and paren-awareness included, from three
    // engines that must agree byte for byte. Pinned by the corpus in both
    // directions so the engines cannot each pick a tokenization: DO NOT "fix"
    // this row - handling it correctly is a divergence, not an improvement.
    expect(attr(img('srcset="https://example.com/a,data:x 1x"'), 'srcset')).toBe('')
    expect(renderedAttrValue('srcset', 'https://example.com/a,data:x 1x')).toBe('')
  })

  it('the name match is case-insensitive and the element keeps the author spelling', () => {
    expect(renderedAttrValue('SRCSET', 'safe.png 1x, javascript:alert(1) 2x')).toBe('')
    expect(renderedAttrValue('Ping', 'safe.html javascript:alert(1)')).toBe('')
    expect(renderedAttrValue('AttributionSrc', 'safe.html javascript:alert(1)')).toBe('')
    // Matching the exact bytes would leave `SRCSET` unprobed, and the element
    // still carries the case the author wrote.
    const out = img('SRCSET="safe.png 1x, javascript:alert(1) 2x"')
    expect(out).toContain('SRCSET=""')
    expect(attr(out, 'SRCSET')).toBe('')
  })

  it('the value-wide probe still runs for these four names, so the fix denies MORE and never less', () => {
    // The strip class is WIDER than the split class in both directions. A
    // token-only implementation would ADMIT this: `java` and `script:alert(1)`
    // are two clean tokens, and the scheme only appears once the value-wide
    // strip closes the gap the ASCII-whitespace split had just opened. That
    // spelling is refused today and the clause changes WHERE the probe runs,
    // not WHAT it denies - so the token pass is added to the value-wide one,
    // not swapped for it.
    for (const name of URL_LIST) {
      expect(renderedAttrValue(name, `java script:alert(1)`), name).toBe('')
      expect(renderedAttrValue(name, `java\tscript:alert(1)`), name).toBe('')
    }
    expect(attr(link('ping="java script:alert(1)"'), 'ping')).toBe('')
  })

  it('the strip composes PER TOKEN, so an obfuscated candidate blanks wherever it sits', () => {
    expect(renderedAttrValue('srcset', `safe.png 1x, ${NBSP_NARROW}javascript:alert(1) 2x`)).toBe('')
    expect(renderedAttrValue('ping', `safe.html ${NBSP_NARROW}javascript:alert(1)`)).toBe('')
    expect(attr(link(`ping="safe.html ${NBSP_NARROW}javascript:alert(1)"`), 'ping')).toBe('')
  })

  it('the Cf decision composes unchanged, at EVERY position', () => {
    // A token beginning `<U+200B>javascript:` is left alone, for the reason
    // already in the clause: it fails WHATWG URL parsing and lands inert. The
    // leading position behaves the same way, which is what "unchanged" means.
    const trailing = `safe.html ${ZWSP}javascript:alert(1)`
    expect(renderedAttrValue('ping', trailing)).toBe(trailing)
    const leading = `${ZWSP}javascript:alert(1) safe.html`
    expect(renderedAttrValue('ping', leading)).toBe(leading)
  })

  it('the SPLIT breaks on ASCII whitespace only, narrower than what the STRIP removes', () => {
    // `a<U+202F>javascript:x` is ONE token to a consumer, because both grammars
    // put their boundaries at ASCII whitespace, and it resolves as a relative
    // URL rather than a navigation. Widening the split to `\s` would blank it.
    const one = `a${NBSP_NARROW}javascript:x`
    expect(renderedAttrValue('ping', one)).toBe(one)
    expect(renderedAttrValue('srcset', `${one} 1x`)).toBe(`${one} 1x`)
  })

  it('empty tokens are skipped rather than probed', () => {
    expect(renderedAttrValue('ping', '  safe.html  ')).toBe('  safe.html  ')
    expect(renderedAttrValue('srcset', ', ,safe.png 1x, ,')).toBe(', ,safe.png 1x, ,')
  })

  it('PROSE IS NOT TOKENIZED: a colon in ordinary text survives', () => {
    // The false-positive bound, and the direction that keeps this rule
    // acceptable. Each of these has a colon in a non-leading token, and each
    // must render verbatim - a tokenizing probe applied to prose would refuse
    // all of them.
    const prose = 'See: RFC 3986, http://example.com'
    for (const name of ['title', 'alt', 'aria-label']) {
      expect(renderedAttrValue(name, prose), name).toBe(prose)
    }
    expect(attr(link(`title="${prose}"`), 'title')).toBe('See: RFC 3986, http://example.com')
    // Even the payload spelling: `title` is not in the set, so its non-leading
    // token is not read. The leading-scheme rule is all that applies to it.
    const notASink = 'see javascript:alert(1)'
    expect(renderedAttrValue('title', notASink)).toBe(notASink)
  })

  it('the set is closed by the criterion, and a lookalike stays out', () => {
    // `itemtype` and `itemprop` are space-separated absolute-URL token lists,
    // but the standard forbids dereferencing them - identifiers, not sinks. If
    // the set is ever widened by pattern-match instead of by the criterion,
    // this row is what says so.
    const list = 'https://schema.org/Thing javascript:alert(1)'
    for (const name of ['itemtype', 'itemprop', 'headers', 'for', 'rel', 'class']) {
      expect(renderedAttrValue(name, list), name).toBe(list)
    }
    // `itemid` is a SINGLE URL, so the leading rule already reaches it and the
    // token rule is not needed there.
    expect(renderedAttrValue('itemid', 'javascript:alert(1)')).toBe('')
    expect(renderedAttrValue('itemid', 'safe.html javascript:alert(1)')).toBe(
      'safe.html javascript:alert(1)',
    )
  })

  it('CONTROL: a legitimate URL list of any length renders verbatim', () => {
    // The rule must be invisible to every value that has no denylisted scheme
    // in it. A mutation that blanks on the presence of a separator, or on any
    // colon in any token, goes red here and nowhere else.
    const srcset = 'https://example.com/a.png 1x, https://example.com/b.png 2x'
    expect(renderedAttrValue('srcset', srcset)).toBe(srcset)
    expect(attr(img(`srcset="${srcset}"`), 'srcset')).toBe(
      'https://example.com/a.png 1x, https://example.com/b.png 2x',
    )
    const ping = 'https://example.com/a https://example.com/b'
    expect(renderedAttrValue('ping', ping)).toBe(ping)
    expect(attr(link(`ping="${ping}"`), 'ping')).toBe(ping)
  })
})

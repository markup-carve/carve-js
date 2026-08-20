import { describe, expect, it } from 'vitest'
import { perfIt } from './helpers/scaling.js'

import {
  applyProfile,
  canonicalType,
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  LinkPolicy,
  parse,
  Profile,
  ProfileViolationError,
  resolve,
} from '../src/index.js'

describe('Profile: type resolution', () => {
  it('denies a type not in the allowlist', () => {
    const p = Profile.comment()
    expect(p.isTypeAllowed('heading')).toBe(false)
    expect(p.isTypeAllowed('paragraph')).toBe(true)
  })

  it('deny list beats an allow list', () => {
    const p = new Profile().allowBlock(['paragraph', 'heading']).denyBlock(['heading'])
    expect(p.isTypeAllowed('heading')).toBe(false)
    expect(p.isTypeAllowed('paragraph')).toBe(true)
  })

  it('null allow list means all allowed (except denied)', () => {
    const p = new Profile().denyInline(['raw_inline'])
    expect(p.isTypeAllowed('emphasis')).toBe(true)
    expect(p.isTypeAllowed('raw_inline')).toBe(false)
  })

  it('document is always allowed; an allow list excludes an unknown type', () => {
    const p = Profile.minimal()
    expect(p.isTypeAllowed('document')).toBe(true)
    // `minimal` sets allow lists, so step 2 of profiles.md "Resolution"
    // excludes a type not in them - including one the vocabulary never had.
    expect(p.isTypeAllowed('not_a_real_type')).toBe(false)
    expect(p.isTypeAllowed('not_a_real_type', true)).toBe(false)
    expect(p.isTypeAllowed('not_a_real_type', false)).toBe(false)
  })

  it('a profile that denies nothing allows an unknown type', () => {
    // The rule the spec made explicit: the three steps are exhaustive and an
    // implementation MUST NOT add a fourth denying unrecognized types. This
    // used to return false, so a construct whose type predated the vocabulary
    // rendered as nothing under `full()` (carve#419).
    const p = Profile.full()
    expect(p.isTypeAllowed('not_a_real_type')).toBe(true)
    expect(p.isTypeAllowed('not_a_real_type', true)).toBe(true)
    expect(p.isTypeAllowed('not_a_real_type', false)).toBe(true)
  })

  it('deny still beats an unknown type on its own axis', () => {
    const p = Profile.full().denyInline(['not_a_real_type'])
    expect(p.isTypeAllowed('not_a_real_type', false)).toBe(false)
    expect(p.isTypeAllowed('not_a_real_type', true)).toBe(true)
  })
})

describe('Profile: canonical type mapping', () => {
  it('maps carve-js internal types to canonical snake_case', () => {
    expect(canonicalType('code_block')).toBe('code_block')
    expect(canonicalType('block_quote')).toBe('block_quote')
    expect(canonicalType('list_item')).toBe('list_item')
    expect(canonicalType('soft_break')).toBe('soft_break')
    expect(canonicalType('hard_break')).toBe('hard_break')
    expect(canonicalType('thematic_break')).toBe('thematic_break')
    expect(canonicalType('raw_block')).toBe('raw_block')
    expect(canonicalType('raw_inline')).toBe('raw_inline')
    expect(canonicalType('definition_list')).toBe('definition_list')
    expect(canonicalType('emphasis')).toBe('emphasis')
    expect(canonicalType('superscript')).toBe('superscript')
    expect(canonicalType('subscript')).toBe('subscript')
    expect(canonicalType('insert')).toBe('insert')
    expect(canonicalType('delete')).toBe('delete')
  })

  it('maps a tag under the mention feature', () => {
    // `tag` is not in the canonical vocabulary; `mention` is.
    expect(canonicalType('tag')).toBe('mention')
  })

  it('keeps autolink and admonition as their own canonical names', () => {
    // profiles.md requires both to be nameable on their own. Folding them into
    // `link` / `div` made naming them a silent no-op (issue 362).
    expect(canonicalType('autolink')).toBe('autolink')
    expect(canonicalType('admonition')).toBe('admonition')
  })

  it('returns the type itself when there is no fold, so it stays resolvable', () => {
    // Returning undefined was the defect: the filter treated "no canonical
    // mapping" as "deny", so a full profile deleted these types outright.
    // profiles.md's three resolution steps are exhaustive - an unmapped type
    // reaches the deny/allow lists unchanged instead of being denied for not
    // being listed.
    expect(canonicalType('heading_ref')).toBe('heading_ref')
    expect(canonicalType('caption_number')).toBe('caption_number')
  })

  it('maps symbol as a canonical inline feature', () => {
    expect(canonicalType('symbol')).toBe('symbol')
  })
})

function filter(src: string, profile: Profile, baseHost?: string) {
  const doc = resolve(parse(src))
  return applyProfile(doc, profile, baseHost ?? null)
}

describe('Profile: disallowed actions', () => {
  it('to_text replaces a denied inline node with its label', () => {
    expect(carveToHtml('![alt](x.png)', { profile: Profile.minimal() })).toBe('<p>[img: alt]</p>')
    expect(carveToHtml('[text](https://x.com)', { profile: Profile.minimal() })).toBe('<p>text</p>')
  })

  it('to_text wraps a denied block node in a paragraph', () => {
    expect(carveToHtml('# Title', { profile: Profile.comment() })).toBe('<p># Title</p>')
  })

  it('strip removes a denied node and its subtree', () => {
    const p = Profile.comment().onDisallowed('strip')
    expect(carveToHtml('text ![alt](x.png) more', { profile: p })).toBe('<p>text  more</p>')
    expect(carveToHtml('# H\n\nbody', { profile: p })).toBe('<p>body</p>')
  })

  it('error collects violations and throws ProfileViolationError', () => {
    const p = Profile.comment().onDisallowed('error')
    expect(() => carveToHtml('# H', { profile: p })).toThrow(ProfileViolationError)
    try {
      carveToHtml('# H', { profile: p })
    } catch (e) {
      const err = e as ProfileViolationError
      expect(err.violations).toHaveLength(1)
      expect(err.violations[0]!.nodeType).toBe('heading')
      expect(err.violations[0]!.reason).toBe('element_not_allowed')
      expect(err.message).toContain("'heading' is not allowed")
    }
  })

  it('records violations without throwing for to_text/strip', () => {
    const { violations } = filter('# H\n\n![a](x.png)', Profile.comment())
    expect(violations.map((v) => v.nodeType).sort()).toEqual(['heading', 'image'])
  })

  it('filters a denied figure target node', () => {
    // A figure target is a single-node field, not an array; a denied image
    // target must still be converted to text (parity with carve-php).
    const p = new Profile().allowBlock(['paragraph', 'figure']).allowInline(['text']).denyInline(['image'])
    const html = carveToHtml('![alt](x.png)\n^ cap', { profile: p })
    expect(html).toContain('[img: alt]')
    expect(html).not.toContain('<img')
  })

  it('filters denied nodes inside a referenced footnote definition', () => {
    // footnoteDefs live outside the tree but every renderer emits them, so a
    // denied image inside a footnote must still be converted to text (parity
    // with carve-php, which keeps defs in the tree).
    const p = new Profile().denyInline(['image'])
    const html = carveToHtml('text[^1]\n\n[^1]: note ![a](x.png)', { profile: p })
    expect(html).toContain('note [img: a]')
    expect(html).not.toContain('<img')
  })
})

describe('Profile: maxNesting', () => {
  it('flattens list nesting deeper than the limit (minimal = 2)', () => {
    // The deepest items exceed depth 2 and are converted to text in place.
    const html = carveToHtml('- a\n  - b\n    - c', { profile: Profile.minimal() })
    expect(html).toContain('b - c')
    expect(html).not.toContain('<li>c</li>')
  })

  it('0 means unlimited', () => {
    const p = new Profile().setMaxNesting(0)
    const html = carveToHtml('- a\n  - b\n    - c\n      - d', { profile: p })
    expect(html).toContain('d')
  })
})

describe('Profile: maxLength', () => {
  it('throws when source byte length exceeds the limit', () => {
    const p = new Profile().setMaxLength(5)
    expect(() => carveToHtml('hello world', { profile: p })).toThrow(/maximum length/)
  })

  it('allows input within the limit', () => {
    const p = new Profile().setMaxLength(100)
    expect(carveToHtml('hi', { profile: p })).toBe('<p>hi</p>')
  })

  it('untrusted presets carry a default length cap', () => {
    expect(Profile.comment().getMaxLength()).toBe(Profile.COMMENT_MAX_LENGTH)
    expect(Profile.minimal().getMaxLength()).toBe(Profile.MINIMAL_MAX_LENGTH)
    // The trusted presets stay unlimited.
    expect(Profile.full().getMaxLength()).toBe(0)
    expect(Profile.article().getMaxLength()).toBe(0)
  })

  it('the comment preset rejects an over-cap body and accepts one within', () => {
    const tooLong = 'a'.repeat(Profile.COMMENT_MAX_LENGTH + 1)
    expect(() => carveToHtml(tooLong, { profile: Profile.comment() })).toThrow(/maximum length/)
    expect(carveToHtml('hi there', { profile: Profile.comment() })).toBe('<p>hi there</p>')
  })

  it('a preset cap is overridable with setMaxLength(0)', () => {
    const p = Profile.minimal().setMaxLength(0)
    const long = 'word '.repeat(Profile.MINIMAL_MAX_LENGTH)
    expect(() => carveToHtml(long, { profile: p })).not.toThrow()
  })

  perfIt('the length guard runs pre-parse: an over-cap input is rejected without parsing it', () => {
    // A tiny cap with a large, otherwise-valid input. If the check were still
    // post-parse, the parser would chew through the whole input before throwing;
    // pre-parse it rejects in ~no time. The generous bound only fails if the
    // check regresses back behind parse().
    //
    // NOTE: time is a PROXY here for the thing actually being asserted, which is
    // "parse() was never entered". That is why this reads 194ms against a 100ms
    // bound on a loaded machine while the guard it protects is perfectly intact.
    // The real fix is to assert the observable -- spy on parse and assert it was
    // not called -- which needs a seam this module does not expose yet. Gated
    // for now so a busy runner cannot fail it.
    const p = new Profile().setMaxLength(5)
    const huge = '[a]('.repeat(1_000_000) // ~4 MB
    const start = performance.now()
    expect(() => carveToHtml(huge, { profile: p })).toThrow(/maximum length/)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe('LinkPolicy', () => {
  it('blocks dangerous schemes by default', () => {
    const lp = LinkPolicy.unrestricted()
    expect(lp.isUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(lp.isUrlAllowed('data:text/html,x')).toBe(false)
    expect(lp.isUrlAllowed('https://ok.com')).toBe(true)
  })

  it('internalOnly blocks external absolute URLs but keeps relative/fragment', () => {
    const lp = LinkPolicy.internalOnly()
    expect(lp.isUrlAllowed('https://ext.com')).toBe(false)
    expect(lp.isUrlAllowed('/local')).toBe(true)
    expect(lp.isUrlAllowed('#sec')).toBe(true)
  })

  it('allowlist permits listed domains and their subdomains only', () => {
    const lp = LinkPolicy.allowlist(['good.com'])
    expect(lp.isUrlAllowed('https://good.com/p')).toBe(true)
    expect(lp.isUrlAllowed('https://a.good.com/p')).toBe(true)
    expect(lp.isUrlAllowed('https://bad.com/p')).toBe(false)
  })

  it('comment profile adds nofollow ugc rel to surviving links', () => {
    expect(carveToHtml('[text](https://x.com)', { profile: Profile.comment() })).toBe(
      '<p><a href="https://x.com" rel="nofollow ugc">text</a></p>',
    )
  })

  it('merges rel onto an existing rel attribute', () => {
    expect(
      carveToHtml('[text](https://x.com){.cls #id rel="me"}', { profile: Profile.comment() }),
    ).toBe('<p><a href="https://x.com" class="cls" id="id" rel="me nofollow ugc">text</a></p>')
  })

  it('a denied link URL follows the disallowed action (to_text -> label)', () => {
    const p = Profile.full().setLinkPolicy(LinkPolicy.internalOnly())
    expect(carveToHtml('[x](https://ext.com)', { profile: p })).toBe('<p>x</p>')
  })
})

/*
 * A scheme carrying a character a URL consumer discards (markup-carve/carve-js#917).
 *
 * EVERY assertion here is on the BYTES of the destination, never on how it
 * renders. `java<DEL>script:` prints as `javascript:` in any terminal, which is
 * how an earlier report of the sibling renderer defect concluded the character
 * had been normalized away when it had not; a test written against the rendered
 * string passes on the broken engine.
 */
const SOH = String.fromCharCode(0x01) // U+0001, inside PART 9 §29's class
const DEL = String.fromCharCode(0x7f) // U+007F, outside it
const CSI = String.fromCharCode(0x9b) // U+009B, outside it
const NBSP = String.fromCharCode(0xa0) // U+00A0, whitespace, not a control

/** The code points of `s`, so a failure names the byte instead of hiding it. */
function points(s: string): string[] {
  return [...s].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
}

describe('LinkPolicy: a scheme split by a character a consumer discards', () => {
  const splits: Array<[string, string]> = [
    ['U+0001 SOH', `java${SOH}script:alert(1)`],
    ['U+007F DEL', `java${DEL}script:alert(1)`],
    ['U+009B CSI', `java${CSI}script:alert(1)`],
    ['U+00A0 NBSP', `java${NBSP}script:alert(1)`],
  ]

  it('carries the splitting byte, so these are not the plain spelling', () => {
    // Guards every row below: if a layer ever normalized the character away,
    // the rows would pass for a reason that has nothing to do with the policy.
    expect(points(`java${SOH}script:`)).toContain('U+0001')
    expect(points(`java${DEL}script:`)).toContain('U+007F')
    expect(points(`java${CSI}script:`)).toContain('U+009B')
    expect(points(`java${NBSP}script:`)).toContain('U+00A0')
  })

  it('CONTROL: the plain denied spelling is still refused', () => {
    const lp = new LinkPolicy()
    expect(lp.getDeniedSchemes()).toEqual(['javascript', 'vbscript', 'data', 'file'])
    expect(lp.isUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(lp.isUrlAllowed(' javascript:alert(1)')).toBe(false)
  })

  it('CONTROL: a legitimate destination is still allowed', () => {
    const lp = new LinkPolicy()
    expect(lp.isUrlAllowed('https://example.com/a')).toBe(true)
    expect(lp.isUrlAllowed('http://example.com/a')).toBe(true)
    expect(lp.isUrlAllowed('mailto:a@example.com')).toBe(true)
    expect(lp.isUrlAllowed('./a/b')).toBe(true)
    expect(lp.isUrlAllowed('#sec')).toBe(true)
    expect(lp.isUrlAllowed('//example.com/a')).toBe(true)
    expect(lp.isUrlAllowed('notascheme')).toBe(true)
  })

  it.each(splits)('the denylist refuses a scheme split by %s', (_label, url) => {
    const lp = new LinkPolicy()
    expect(lp.isUrlAllowed(url)).toBe(false)
  })

  it('refuses every default-denied scheme in its split spelling', () => {
    const lp = new LinkPolicy()
    expect(lp.isUrlAllowed(`da${DEL}ta:text/html,x`)).toBe(false)
    expect(lp.isUrlAllowed(`fi${DEL}le:///etc/passwd`)).toBe(false)
    expect(lp.isUrlAllowed(`vb${DEL}script:x`)).toBe(false)
  })

  it('a split scheme no longer skips the domain denylist', () => {
    // The scheme read gated the host checks: `htt<DEL>ps` was neither `http`
    // nor `https`, so a denied domain was never consulted.
    const lp = new LinkPolicy().setDeniedDomains(['evil.com'])
    expect(lp.isUrlAllowed('https://evil.com/a')).toBe(false)
    expect(lp.isUrlAllowed(`htt${DEL}ps://evil.com/a`)).toBe(false)
    expect(lp.isUrlAllowed(`htt${SOH}ps://evil.com/a`)).toBe(false)
    // CONTROL: an undenied host is still allowed, and its bytes are its own.
    expect(lp.isUrlAllowed('https://good.com/a')).toBe(true)
  })

  it('a split scheme no longer skips the allowExternal check', () => {
    const lp = new LinkPolicy().setAllowExternal(false)
    expect(lp.isUrlAllowed('https://example.com/a')).toBe(false)
    expect(lp.isUrlAllowed(`htt${DEL}ps://example.com/a`)).toBe(false)
    expect(lp.isUrlAllowed(`htt${SOH}ps://example.com/a`)).toBe(false)
  })

  it('CONTROL: the allowlist form still fails closed, split or not', () => {
    // This is the claim an earlier revision of the ticket got wrong and then
    // retracted, so it is pinned rather than argued. An allowlist refuses a
    // scheme it does not recognize, and a split scheme is one - which is why
    // the ALLOW lookup deliberately still reads the raw text.
    const lp = new LinkPolicy().setAllowedSchemes(['https'])
    expect(lp.getAllowedSchemes()).toEqual(['https'])
    expect(lp.isUrlAllowed('javascript:alert(1)')).toBe(false)
    for (const [, url] of splits) expect(lp.isUrlAllowed(url)).toBe(false)
    expect(lp.isUrlAllowed(`htt${DEL}ps://example.com/a`)).toBe(false)
    expect(lp.isUrlAllowed(`htt${SOH}ps://example.com/a`)).toBe(false)
    // CONTROL: the one scheme it names is still allowed.
    expect(lp.isUrlAllowed('https://example.com/a')).toBe(true)
  })

  it('the link and the image path both refuse it', () => {
    // Denying `https` isolates the profile from PART 9 §25: the renderer has no
    // quarrel with that scheme, so anything blanked here came from the policy.
    // The image spelling reaches the same isUrlAllowed, and this asserts that
    // rather than assuming it.
    const p = Profile.full().setLinkPolicy(new LinkPolicy().setDeniedSchemes(['https']))
    expect(carveToHtml(`[x](htt${DEL}ps://x.com)`, { profile: p })).toBe('<p>x</p>')
    expect(carveToHtml(`![alt](htt${DEL}ps://x.com)`, { profile: p })).toBe('<p>[img: alt]</p>')
    // CONTROL: a scheme the policy does not deny survives both spellings.
    expect(carveToHtml('[x](http://x.com)', { profile: p })).toBe(
      '<p><a href="http://x.com">x</a></p>',
    )
  })
})

describe('Profile presets behave per spec', () => {
  it('full allows everything', () => {
    const p = Profile.full()
    expect(p.isTypeAllowed('raw_block')).toBe(true)
    expect(p.isTypeAllowed('heading')).toBe(true)
    expect(p.isTypeAllowed('math')).toBe(true)
  })

  it('article denies only raw block/inline', () => {
    const p = Profile.article()
    expect(p.isTypeAllowed('raw_block')).toBe(false)
    expect(p.isTypeAllowed('raw_inline')).toBe(false)
    expect(p.isTypeAllowed('heading')).toBe(true)
    expect(p.isTypeAllowed('table')).toBe(true)
  })

  it('comment allowlist denies headings, images, tables, footnotes', () => {
    const p = Profile.comment()
    for (const t of ['heading', 'image', 'table', 'footnote_ref', 'div', 'thematic_break']) {
      expect(p.isTypeAllowed(t)).toBe(false)
    }
    for (const t of ['paragraph', 'list', 'block_quote', 'code_block', 'link', 'highlight']) {
      expect(p.isTypeAllowed(t)).toBe(true)
    }
  })

  it('minimal denies link, image, highlight; keeps paragraphs and lists', () => {
    const p = Profile.minimal()
    expect(p.isTypeAllowed('link')).toBe(false)
    expect(p.isTypeAllowed('image')).toBe(false)
    expect(p.isTypeAllowed('highlight')).toBe(false)
    expect(p.isTypeAllowed('paragraph')).toBe(true)
    expect(p.isTypeAllowed('list')).toBe(true)
    expect(p.isTypeAllowed('block_quote')).toBe(false)
  })

  it('applies to non-HTML renderers too', () => {
    // The profile transform runs before any renderer, so the markdown/plain
    // output also drops a denied heading.
    expect(carveToMarkdown('# Title', { profile: Profile.comment() })).toContain('# Title')
    expect(carveToPlainText('![a](x.png)', { profile: Profile.minimal() })).toContain('[img: a]')
  })
})

/*
 * GOLDEN PARITY: the expected strings below were produced by carve-php
 *
 *   printf '%s' INPUT | php -r 'require ".../vendor/autoload.php";
 *     echo (new Carve\CarveConverter(profile: Carve\Profile::PRESET()))
 *       ->convert(file_get_contents("php://stdin"));'
 *
 * carve-php appends a trailing blank line after block output and keeps an
 * orphaned footnote definition as a paragraph; carve-js does neither. Those
 * are pre-existing, profile-independent rendering differences, so the fixtures
 * record the carve-js-shaped output and the cases are chosen so the profile
 * *effect* (which nodes survive / are to_text'd) is identical to carve-php.
 */
const PHP_GOLDEN: { preset: 'full' | 'article' | 'comment' | 'minimal'; src: string; out: string }[] = [
  // --- article: raw block disabled, everything else passes ---
  { preset: 'article', src: '``` =html\n<b>x</b>\n```', out: '<p>&lt;b&gt;x&lt;/b&gt;</p>' },
  {
    preset: 'article',
    src: '| a | b |\n|---|---|\n| 1 | 2 |',
    out:
      '<table>\n  <thead>\n    <tr><th scope="col">a</th><th scope="col">b</th></tr>\n  </thead>\n' +
      '  <tbody>\n    <tr><td>1</td><td>2</td></tr>\n  </tbody>\n</table>',
  },
  // --- comment: headings/images/tables -> to_text, links get nofollow ugc ---
  { preset: 'comment', src: '# Hello world', out: '<p># Hello world</p>' },
  { preset: 'comment', src: '![alt text](img.png)', out: '<p>[img: alt text]</p>' },
  { preset: 'comment', src: '![](img.png)', out: '<p>[img]</p>' },
  {
    preset: 'comment',
    src: '| a | b |\n|---|---|\n| 1 | 2 |',
    out: '<p>a | b<br>\n1 | 2</p>',
  },
  {
    preset: 'comment',
    src: '[text](https://example.com)',
    out: '<p><a href="https://example.com" rel="nofollow ugc">text</a></p>',
  },
  {
    preset: 'comment',
    src: '[home](/home)',
    out: '<p><a href="/home" rel="nofollow ugc">home</a></p>',
  },
  { preset: 'comment', src: '``` =html\n<b>x</b>\n```', out: '<p>&lt;b&gt;x&lt;/b&gt;</p>' },
  { preset: 'comment', src: '- one\n- two', out: '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>' },
  { preset: 'comment', src: '> quoted text', out: '<blockquote><p>quoted text</p></blockquote>' },
  { preset: 'comment', src: '`inline code`', out: '<p><code>inline code</code></p>' },
  // --- minimal: links/images -> to_text, blockquote -> to_text ---
  { preset: 'minimal', src: '[text](https://example.com)', out: '<p>text</p>' },
  { preset: 'minimal', src: '![alt text](img.png)', out: '<p>[img: alt text]</p>' },
  { preset: 'minimal', src: '> quoted text', out: '<p>&gt; quoted text</p>' },
  { preset: 'minimal', src: '- one\n- two', out: '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>' },
  // --- full: passthrough ---
  {
    preset: 'full',
    src: 'Just a paragraph with *bold* and /italic/.',
    out: '<p>Just a paragraph with <strong>bold</strong> and <em>italic</em>.</p>',
  },
]

describe('Profile golden parity with carve-php', () => {
  for (const { preset, src, out } of PHP_GOLDEN) {
    it(`${preset} :: ${JSON.stringify(src)}`, () => {
      expect(carveToHtml(src, { profile: Profile[preset]() })).toBe(out)
    })
  }
})

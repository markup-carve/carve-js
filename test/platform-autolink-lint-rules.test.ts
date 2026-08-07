import { describe, it, expect } from 'vitest'
import { lintCarve, KNOWN_LINT_PLATFORMS } from '../src/index.js'
import { run as runCli, type CliIO } from '../src/cli.js'

/**
 * `carve lint` platform-autolink rules: opt-in, platform-scoped, DEFAULT OFF
 * (ruled on markup-carve/carve#297, markup-carve/carve-js#848).
 *
 * The source is the only place the author's intent still exists. No
 * render-time construct prevents a host from re-linkifying published output,
 * so a bare hash-number becomes a link to an unrelated issue and a bare at-word
 * becomes a mention that notifies an uninvolved person.
 *
 * TWO INVARIANTS the spec repo's harness will assert once the rows are on the
 * page, and both are pinned here first:
 *
 *   1. DEFAULT OFF - `lintCarve(source)` with no options must not emit either
 *      rule, for any input.
 *   2. REACHABLE BY NAME - a documented rule needs a trigger, so there must be
 *      a supported way to ask for it that a test can call.
 *
 * `docs/validation.md` in the spec repo gates the rule table in both
 * directions, and calls a documented rule nothing can produce "a promise with
 * no producer". These two ids are fixed HERE first, because carve-php will
 * have to use the same ones.
 */

const platformRules = (findings: { rule: string }[]) =>
  findings.filter((w) => w.rule.startsWith('platform-')).map((w) => w.rule)

/** Documents that must trigger, one per rule - the harness's trigger entries. */
const TRIGGERS = {
  'platform-mention-token': 'Use @minutely for that cron alias.\n',
  'platform-issue-reference': 'See #123 for the discussion.\n',
}

describe('platform-autolink lint rules', () => {
  it('INVARIANT 1: emits nothing by default, for any input', () => {
    // Every shape that triggers under opt-in, plus the false-trigger set the
    // ruling names, run through the DEFAULT call.
    const docs = [
      ...Object.values(TRIGGERS),
      'Cron: @hourly @daily @weekly @reboot @midnight.\n',
      'Docblock: @param @return @throws @since @deprecated.\n',
      'Decorators: @property @staticmethod @dataclass.\n',
      'Scope: @types/node and @angular/core.\n',
      'Items #1, #2 and #5.\n',
      'The `@param` tag and `#1` item.\n',
    ]
    for (const doc of docs) {
      expect({ doc, rules: platformRules(lintCarve(doc)) }).toEqual({ doc, rules: [] })
      // And with an explicitly empty list, which is what a caller threading an
      // unset config through will pass.
      expect(platformRules(lintCarve(doc, { platforms: [] }))).toEqual([])
    }
  })

  it('INVARIANT 2: each id is reachable by name, with a trigger that produces it', () => {
    for (const [rule, doc] of Object.entries(TRIGGERS)) {
      expect({ rule, got: platformRules(lintCarve(doc, { platforms: ['github'] })) }).toEqual({
        rule,
        got: [rule],
      })
    }
  })

  it('reports the position of the token, not of the line', () => {
    const doc = 'Use @minutely for that cron alias.\n'
    const [w] = lintCarve(doc, { platforms: ['github'] })
    expect({ line: w!.line, column: w!.column, text: doc.slice(w!.start, w!.end) }).toEqual({
      line: 1,
      column: 5,
      text: '@minutely',
    })
  })

  it('reports UTF-16 offsets, so an astral character does not shift the span', () => {
    // Raised by codex review. `LintWarning` documents UTF-16 offsets into the
    // source the caller passed, and this scan already counts in that unit -
    // passing it through the codepoint map the tree-derived findings use
    // shifted every span after an astral character by one per character.
    const doc = '\u{1F600} @minutely here.\n'
    const [w] = lintCarve(doc, { platforms: ['github'] })
    expect(doc.slice(w!.start, w!.end)).toBe('@minutely')
    // CONTROL: the same document with no astral character is unaffected.
    const plain = 'x @minutely here.\n'
    const [p] = lintCarve(plain, { platforms: ['github'] })
    expect(plain.slice(p!.start, p!.end)).toBe('@minutely')
  })

  it('ignores an unknown platform name that exists on Object.prototype', () => {
    // Raised by codex review. `'toString' in PLATFORM_RULES` is true, so an
    // untyped caller threading a config value through crashed on the lookup.
    for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
      expect({
        name,
        rules: platformRules(lintCarve('Use @minutely.\n', { platforms: [name as 'github'] })),
      }).toEqual({ name, rules: [] })
    }
  })

  it('flags a token inside an INLINE CODE SPAN', () => {
    // Not reliably safe: some host surfaces still linkify inside them, which is
    // the case that makes the rule worth having at all.
    const doc = 'The `@param` tag and the `#1` item.\n'
    expect(platformRules(lintCarve(doc, { platforms: ['github'] }))).toEqual([
      'platform-mention-token',
      'platform-issue-reference',
    ])
  })

  it('does NOT flag a token in a fenced code block, a raw block or a comment', () => {
    // Fenced blocks are reliably safe; a comment is never published at all.
    const doc = [
      '```',
      '@param #1',
      '```',
      '',
      '```=html',
      '@param #2',
      '```',
      '',
      '%% @param #3',
      '',
      '%%%',
      '@param #4',
      '%%%',
      '',
    ].join('\n')
    expect(platformRules(lintCarve(doc, { platforms: ['github'] }))).toEqual([])
    // CONTROL: the same tokens in prose DO flag, so the document above is not
    // passing because the matcher is broken.
    expect(platformRules(lintCarve('@param #1\n', { platforms: ['github'] }))).toEqual([
      'platform-mention-token',
      'platform-issue-reference',
    ])
  })

  it('does not flag text that is never published', () => {
    // Raised by codex review. Frontmatter is metadata the renderer omits from
    // the body, and a link reference definition renders as the empty string -
    // only the links resolving it are published, and their visible text is
    // their label. Both were spurious failures on valid documents, which is the
    // failure mode the ruling warns about most.
    const doc = [
      '---',
      'author: @alice',
      'issue: #12',
      '---',
      '',
      '[ref]: /x "@alice wrote #7"',
      '',
      'body',
      '',
    ].join('\n')
    expect(platformRules(lintCarve(doc, { platforms: ['github'] }))).toEqual([])
    // CONTROL: the same tokens in the BODY do flag - and a line that only
    // LOOKS like a definition (a trailing token makes it invalid, so it parses
    // as a paragraph) is published prose and flags too.
    expect(
      platformRules(lintCarve('author: @alice, issue: #12\n', { platforms: ['github'] })),
    ).toEqual(['platform-mention-token', 'platform-issue-reference'])
    expect(
      platformRules(lintCarve('[ref]: https://e.com/x #123\n', { platforms: ['github'] })),
    ).toEqual(['platform-issue-reference'])
  })

  it('does not flag a definition whose line is never rendered', () => {
    // An abbreviation definition renders as the empty string (its expansion
    // reaches the page only as a title attribute), and an UNREFERENCED footnote
    // definition is dropped entirely - and already has its own rule.
    expect(platformRules(lintCarve('*[API]: @internal #1\n\nAPI body\n', { platforms: ['github'] }))).toEqual([])
    expect(platformRules(lintCarve('[^n]: @alice #1\n\nbody\n', { platforms: ['github'] }))).toEqual([])
    // CONTROL: a REFERENCED footnote body is published in the endnotes, so it
    // is scanned.
    expect(platformRules(lintCarve('see[^n]\n\n[^n]: @alice #1\n', { platforms: ['github'] }))).toEqual([
      'platform-mention-token',
      'platform-issue-reference',
    ])
  })

  it('does not flag a token inside a BARE URL', () => {
    // A host linkifies the URL as a URL, so a token in its query or path is
    // part of it rather than a separate mention or issue reference.
    expect(platformRules(lintCarve('See https://e.com/?q=@team here.\n', { platforms: ['github'] }))).toEqual([])
    expect(platformRules(lintCarve('See https://e.com/?issue=#123 here.\n', { platforms: ['github'] }))).toEqual([])
    // CONTROL: a token AFTER the URL still flags, at its real offset - the mask
    // keeps the line length.
    const doc = 'See https://e.com/ and #123 here.\n'
    const [w] = lintCarve(doc, { platforms: ['github'] })
    expect(doc.slice(w!.start, w!.end)).toBe('#123')
    expect(w!.column).toBe(doc.indexOf('#123') + 1)
  })

  it('does not flag a URL fragment or an at-word inside a URL path', () => {
    // A fragment is part of a URL the host linkifies AS a URL, not a separate
    // issue reference, and the same goes for a path segment.
    const doc = 'See [x](https://e.com/#99) and https://e.com/@team here.\n'
    expect(platformRules(lintCarve(doc, { platforms: ['github'] }))).toEqual([])
    // CONTROL: a hash-number after a SPACE is a reference again.
    expect(platformRules(lintCarve('See https://e.com/ #99 here.\n', { platforms: ['github'] }))).toEqual(
      ['platform-issue-reference'],
    )
  })

  it('flags a captioned listing\'s CAPTION, which is published', () => {
    // Raised by codex review. A captioned code block carries no position of its
    // own, so the whole wrapping figure is reported verbatim and the caption
    // rides along inside that range - a false negative on published text.
    const both = ['platform-mention-token', 'platform-issue-reference']
    expect(platformRules(lintCarve('```\nq\n```\n^ Listing @alice #1\n', { platforms: ['github'] }))).toEqual(both)
    expect(platformRules(lintCarve('^ Listing @alice #1\n```\nq\n```\n', { platforms: ['github'] }))).toEqual(both)
    // CONTROLS: a caret line inside the fence BODY is verbatim content, and an
    // uncaptioned listing is skipped whole.
    expect(platformRules(lintCarve('```\n^ @alice #1\n```\n', { platforms: ['github'] }))).toEqual([])
    expect(platformRules(lintCarve('```\n@alice #1\n```\n', { platforms: ['github'] }))).toEqual([])
    // A CONTINUED caption is published on every one of its lines, and the
    // continuation carries no marker - reclaiming by marker missed it.
    expect(
      platformRules(lintCarve('```\nq\n```\n^ Caption\ncontinued @alice #1\n', { platforms: ['github'] })),
    ).toEqual(both)
    // And the same BODY line inside a CAPTIONED listing stays verbatim, because
    // the reclaim is the caption's OWN spans rather than a guess at which lines
    // of the figure carry it.
    const bodyCaret = '```\n^ @alice #1\n```\n^ Caption @bob #2\n'
    const found = lintCarve(bodyCaret, { platforms: ['github'] })
    expect(found.map((f) => bodyCaret.slice(f.start, f.end))).toEqual(['@bob', '#2'])
  })

  it('does not flag a token in an inline link DESTINATION', () => {
    // Raised by codex review. A destination renders as an href, never as
    // visible text, so a host cannot re-linkify it.
    expect(platformRules(lintCarve('See [x](#123) here.\n', { platforms: ['github'] }))).toEqual([])
    expect(platformRules(lintCarve('See [y](@foo) here.\n', { platforms: ['github'] }))).toEqual([])
    // A destination may hold BALANCED parentheses - the whole run is the href -
    // so the mask is walked rather than matched to the first `)`.
    expect(platformRules(lintCarve('See [x](a(b)#123) here.\n', { platforms: ['github'] }))).toEqual([])
    expect(
      platformRules(lintCarve('See [x](a\\(b\\)#123) here.\n', { platforms: ['github'] })),
    ).toEqual([])
    // An ESCAPED closing paren does not end the destination either: the href
    // here is `a)b#123`, and a walk that ignored the escape would stop at it
    // and scan the rest.
    expect(
      platformRules(lintCarve('See [x](a\\)#123) here.\n', { platforms: ['github'] })),
    ).toEqual([])
    // A LABEL HAS TO OPEN SOMEWHERE: a bare `](#123)` in prose is visible text,
    // and so is an escaped `\](#123)`.
    expect(platformRules(lintCarve('See ](#123) here.\n', { platforms: ['github'] }))).toEqual([
      'platform-issue-reference',
    ])
    expect(
      platformRules(lintCarve('See \\](#123) here.\n', { platforms: ['github'] })),
    ).toEqual(['platform-issue-reference'])
    // ...including when a real label opens EARLIER on the line, which is the
    // only shape where the escape check does work the bracket check does not.
    expect(
      platformRules(lintCarve('See [x] and \\](#123) here.\n', { platforms: ['github'] })),
    ).toEqual(['platform-issue-reference'])
    // CONTROL: an UNBALANCED run is not a destination, so it stays prose.
    expect(platformRules(lintCarve('See [x](a(b #123 here.\n', { platforms: ['github'] }))).toEqual([
      'platform-issue-reference',
    ])
    // CONTROL: a parenthesis in PROSE is untouched, so this still flags.
    const doc = 'See (#123) here.\n'
    const [w] = lintCarve(doc, { platforms: ['github'] })
    expect(doc.slice(w!.start, w!.end)).toBe('#123')
    // THE MASK KEEPS THE LINE LENGTH, so a token AFTER a masked destination
    // still indexes the real source. Deleting the destination instead shifts
    // every following offset on that line and passes every case above.
    const after = 'See [x](https://e.com/page) and #123 here.\n'
    const [a] = lintCarve(after, { platforms: ['github'] })
    expect({ text: after.slice(a!.start, a!.end), column: a!.column }).toEqual({
      text: '#123',
      column: after.indexOf('#123') + 1,
    })
  })

  it('skips TYPED frontmatter, not only the bare delimiter form', () => {
    // Raised by codex review: the opener may carry a type word. The skip uses
    // the span the parser REPORTS rather than re-deriving it, so it is exactly
    // what the document has - a hand-matched opener missed the typed form.
    for (const open of ['---', '--- yaml']) {
      const doc = open + '\nauthor: @alice\nissue: #1\n---\n\nbody\n'
      expect({ open, rules: platformRules(lintCarve(doc, { platforms: ['github'] })) }).toEqual({
        open,
        rules: [],
      })
    }
    // CONTROL: a run that is NOT frontmatter (no closer, so the parser reports
    // none) is ordinary published text and still flags.
    expect(
      platformRules(lintCarve('---\nauthor: @alice\n\nbody\n', { platforms: ['github'] })),
    ).toEqual(['platform-mention-token'])
  })

  it('does not flag an email address, a heading marker, or a non-numeric hash run', () => {
    const doc = 'Mail user@example.com about #release-1.0 and #a1.\n\n## 2 things\n'
    expect(platformRules(lintCarve(doc, { platforms: ['github'] }))).toEqual([])
  })

  it('flags every false-trigger shape the ruling names, once opted in', () => {
    // Cron shortcuts, docblock tags, decorators, npm scope prefixes, and
    // enumerated list items - all ordinary technical content, which is why the
    // rules are off by default rather than absent.
    const shapes: Record<string, string> = {
      cron: 'Runs @hourly and @midnight.\n',
      docblock: 'The @param and @deprecated tags.\n',
      decorator: 'A @staticmethod and a @dataclass.\n',
      'npm scope': 'Install @types/node.\n',
      enumerated: 'See #1 and #2.\n',
    }
    const missed = Object.entries(shapes).filter(
      ([, doc]) => platformRules(lintCarve(doc, { platforms: ['github'] })).length === 0,
    )
    expect(missed.map(([name]) => name)).toEqual([])
  })

  it('ignores an unknown platform on the API and refuses one on the CLI', () => {
    // The API is type-checked, so an unknown host there is a caller mistake the
    // compiler catches and the runtime simply has no rules for. A CLI flag has
    // no such reader, and a misspelt `--platform gihub` that reports nothing
    // looks exactly like a clean document.
    expect(
      platformRules(lintCarve('Use @minutely.\n', { platforms: ['gitlab' as 'github'] })),
    ).toEqual([])
    expect(KNOWN_LINT_PLATFORMS).toEqual(['github'])
  })

  it('is reachable from the CLI by name, and off there by default too', async () => {
    const files: Record<string, string> = { 'doc.crv': 'Use @minutely and see #123.\n' }
    const run = async (args: string[]) => {
      let out = ''
      let err = ''
      const io: CliIO = {
        write: (s) => {
          out += s
        },
        writeErr: (s) => {
          err += s
        },
        readFile: (f) => files[f]!,
        readStdin: async () => '',
        writeFile: () => {},
      }
      const code = await runCli(args, io)
      return { code, out, err }
    }
    const off = await run(['lint', 'doc.crv'])
    expect({ code: off.code, hasPlatform: off.out.includes('platform-') }).toEqual({
      code: 0,
      hasPlatform: false,
    })
    const on = await run(['lint', '--platform', 'github', 'doc.crv'])
    expect(on.code).toBe(1)
    expect(on.out).toContain('platform-mention-token')
    expect(on.out).toContain('platform-issue-reference')
    const bad = await run(['lint', '--platform', 'gihub', 'doc.crv'])
    expect({ code: bad.code, err: bad.err.trim() }).toEqual({
      code: 2,
      err: 'carve lint: unknown --platform gihub (known: github)',
    })
  })
})

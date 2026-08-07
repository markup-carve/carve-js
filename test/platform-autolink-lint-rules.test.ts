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

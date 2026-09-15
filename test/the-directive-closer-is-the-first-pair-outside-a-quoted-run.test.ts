import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderHtml, resolve } from '../src/index.js'
import { findDirectives } from '../src/include-directive.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * Spec I1, markup-carve/carve#2000: the directive's closer is the first `}}`
 * that falls OUTSIDE any quoted run.
 *
 * Every row drives the whole expander rather than the regex, because a closer
 * is only observable through what it swallows: `{{ b.crv }}` sits inside the
 * quoted run of each vector, so a recognizer that ends the outer directive at
 * the pair inside the quotes leaves the inner one exposed and RESOLVES it.
 * "Asked for b.crv" is therefore the wrong reading and "asked for nothing" the
 * ruled one, measured end to end.
 */
const INNER = 'INNER-CONTENT-MARKER'

function expand(source: string) {
  const asked: string[] = []
  const result = expandIncludes(parse(source, { positions: true }), source, {
    resolve: (path) => {
      asked.push(path)
      return path === 'b.crv' ? `${INNER}\n` : null
    },
  })
  return { asked, warnings: result.warnings, html: renderHtml(resolve(result.doc)) }
}

describe('the directive closer is the first pair outside a quoted run', () => {
  it('a quoted option value may hold the pair', () => {
    const { asked, html } = expand('{{ ch.crv @label:"a }} {{ b.crv }} more" }} end\n')

    expect(asked).toEqual([])
    expect(html).not.toContain(INNER)
  })

  it('the single-quoted spelling of a value is a run too', () => {
    const { asked, html } = expand("{{ ch.crv @label:'a }} {{ b.crv }} more' }} end\n")

    expect(asked).toEqual([])
    expect(html).not.toContain(INNER)
  })

  it('a quoted path may hold the pair', () => {
    const { asked, html } = expand('{{ "a }} {{ b.crv }} more" @k:v }} end\n')

    expect(asked).toEqual([])
    expect(html).not.toContain(INNER)
  })

  it('an unterminated quote opens no run, so the closer is again the first pair', () => {
    const { asked, html } = expand('{{ ch.crv @label:"a }} {{ b.crv }} more }} end\n')

    expect(asked).toEqual(['b.crv'])
    expect(html).toContain(INNER)
  })

  it('a quote whose partner lies past the closer still leaves the Warning', () => {
    // The fallback reading, not a run: pairing across the closer would leave
    // the token unmatched, and section 19's one forbidden outcome is literal
    // text with no diagnostic.
    const { warnings } = expand('{{ ch.crv @label:"a }} he said "hi" today\n')

    expect(warnings.map((w) => w.rule)).toContain('include-unknown-option')
  })

  it('the span ends after the closing quote, not inside the run', () => {
    expect(findDirectives('{{ ch.crv @label:"a }} more" }} end').map((s) => s.raw)).toEqual([
      '{{ ch.crv @label:"a }} more" }}',
    ])
  })

  it('leaves an ordinary directive where it was', () => {
    expect(findDirectives('{{ a.crv }} it is "fine" here }} x').map((s) => s.raw)).toEqual(['{{ a.crv }}'])
  })

  /**
   * Matching a quoted run to its closing quote and only then hunting for the
   * closer is the shape that backtracks. The two lookaheads are the exact
   * negation of the runs beside them, so at most one alternative is viable at
   * any position and per-byte cost stays flat.
   */
  describe('scan cost stays flat per byte', () => {
    perfIt('over quoted option values', () => {
      expectScansLinearly((input) => void findDirectives(input), '{{ a.crv @k:"v" }} ')
    })

    perfIt('over quoted values that hold the pair', () => {
      expectScansLinearly((input) => void findDirectives(input), '{{ a.crv @k:"a }} b" }} ')
    })

    perfIt('over an unterminated quote followed by a long tail', () => {
      expectScansLinearly((input) => void findDirectives(input), 'x', { prefix: '{{ a.crv @k:"' })
    })

    /**
     * A quoted run and an ordinary character must never both be able to
     * consume the same quote, or every quote doubles the paths through the
     * option slot. Twenty-two runs and no closer is 90 bytes; the lookaheads
     * keep it at microseconds, and the same pattern without them was measured
     * at 6s for twenty runs and 290s for twenty-four. An absolute cap is the
     * right instrument at that margin, and it is gated so it reads the code
     * rather than the runner.
     */
    perfIt('does not blow up on many quoted runs with no closer', () => {
      const source = `{{ a.crv ${'"x" '.repeat(22)}`
      const started = performance.now()

      expect(findDirectives(source)).toEqual([])
      expect(performance.now() - started).toBeLessThan(1000)
    })
  })
})

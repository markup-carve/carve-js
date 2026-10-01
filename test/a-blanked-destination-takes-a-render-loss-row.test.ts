/*
 * A blanked destination owes one render-loss row (PART 9 §25, CARVE-P2-024).
 *
 * The hardening blanked the destination and nothing reported it, so a checked
 * render was silent about the one link a consumer of untrusted input most wants
 * told about (carve#2679, ruled in markup-carve/carve#2681).
 *
 * Two things are pinned here, and the second is the easy mistake: one row per
 * blanked sink, and the emitted value unchanged. Reporting is all that moves.
 */
import { describe, expect, it } from 'vitest'
import { run } from '../src/cli.js'
import {
  carveToAnsiWithReport,
  carveToHtml,
  carveToMarkdown,
  carveToCarveWithReport,
  carveToHtmlWithReport,
  carveToMarkdownWithReport,
  carveToPlainTextWithReport,
} from '../src/index.js'
import { RenderLossError, type RenderLoss } from '../src/render-loss.js'

const LINK = '[x](javascript:alert(1))'
const AUTOLINK = '<javascript:alert(1)>'
const IMAGE = '![x](vbscript:two)'
/** Corpus category 536: one denied link and one denied image in one document. */
const BOTH = '[report me](javascript:one) and ![report me too](vbscript:two)'

/**
 * `--safe` / `allowRawHtml: false` is the raw-passthrough opt-out (PART 9 §25).
 * It does not gate the URL hardening, so it does not gate the reporting either.
 */
const SAFE_MODES: Array<{ allowRawHtml: boolean }> = [{ allowRawHtml: true }, { allowRawHtml: false }]

const codes = (losses: RenderLoss[]): string[] => losses.map((loss) => loss.code)

describe('a blanked destination on the HTML target', () => {
  it.each(SAFE_MODES)('reports a link destination with allowRawHtml $allowRawHtml', (mode) => {
    const result = carveToHtmlWithReport(LINK, mode)
    expect(codes(result.losses)).toEqual(['destination-denied'])
    expect(result.totalLosses).toBe(1)
    expect(result.value).toBe('<p><a href="">x</a></p>')
  })

  it.each(SAFE_MODES)('reports an autolink destination with allowRawHtml $allowRawHtml', (mode) => {
    const result = carveToHtmlWithReport(AUTOLINK, mode)
    expect(codes(result.losses)).toEqual(['destination-denied'])
    expect(result.value).toBe('<p><a href="">javascript:alert(1)</a></p>')
  })

  it.each(SAFE_MODES)('reports an image source with allowRawHtml $allowRawHtml', (mode) => {
    const result = carveToHtmlWithReport(IMAGE, mode)
    expect(codes(result.losses)).toEqual(['destination-denied'])
    expect(result.value).toBe('<img src="" alt="x">')
  })

  it('takes one row per sink, in document order', () => {
    const result = carveToHtmlWithReport(BOTH)
    expect(codes(result.losses)).toEqual(['destination-denied', 'destination-denied'])
    expect(result.totalLosses).toBe(2)
    expect(result.losses.map((loss) => loss.pos?.startColumn)).toEqual([1, 33])
    expect(result.value).toBe('<p><a href="">report me</a> and <img src="" alt="report me too"></p>')
  })

  it('carries the wire shape the schema closes around', () => {
    const [loss] = carveToHtmlWithReport(LINK).losses
    expect(loss).toMatchObject({ code: 'destination-denied', target: 'html', nodeType: 'inline' })
    expect(loss).not.toHaveProperty('format')
    expect(loss?.message).toBeTypeOf('string')
    expect(loss?.pos).toMatchObject({ startLine: 1, startColumn: 1 })
  })

  it('fails a strict checked render', () => {
    expect(() => carveToHtmlWithReport(LINK, { strictLosses: true })).toThrow(RenderLossError)
  })

  it('reports nothing when the host turns the hardening off', () => {
    const result = carveToHtmlWithReport(LINK, { sanitizeUrls: false })
    expect(result.losses).toEqual([])
    expect(result.value).toBe('<p><a href="javascript:alert(1)">x</a></p>')
  })
})

describe('a blanked destination on the other targets', () => {
  it('reports each Markdown sink and keeps the emitted value', () => {
    expect(codes(carveToMarkdownWithReport(LINK).losses)).toEqual(['destination-denied'])
    expect(carveToMarkdownWithReport(LINK).value).toBe('[x]()\n')
    expect(codes(carveToMarkdownWithReport(AUTOLINK).losses)).toEqual(['destination-denied'])
    expect(carveToMarkdownWithReport(AUTOLINK).value).toBe('[javascript:alert(1)]()\n')
    expect(codes(carveToMarkdownWithReport(IMAGE).losses)).toEqual(['destination-denied'])
    expect(carveToMarkdownWithReport(IMAGE).value).toBe('![x]()\n')
    expect(carveToMarkdownWithReport(BOTH).totalLosses).toBe(2)
  })

  it('reports the ANSI link destination it prints beside the text', () => {
    const result = carveToAnsiWithReport(LINK)
    expect(codes(result.losses)).toEqual(['destination-denied'])
    expect(result.losses[0]?.target).toBe('ansi')
    expect(result.value).toContain(' ()')
  })

  it('reports nothing for an ANSI sink that prints no destination', () => {
    // An autolink's visible text IS its URL, and an image prints `[img: alt]`:
    // neither emits a destination, so neither blanks one.
    expect(carveToAnsiWithReport(AUTOLINK).losses).toEqual([])
    expect(carveToAnsiWithReport(IMAGE).losses).toEqual([])
  })

  it('reports nothing on plain text, which emits no URL', () => {
    for (const source of [LINK, AUTOLINK, IMAGE, BOTH]) {
      expect(carveToPlainTextWithReport(source).losses, source).toEqual([])
    }
  })

  it('reports nothing on the canonical Carve writer, which blanks nothing', () => {
    const result = carveToCarveWithReport(BOTH)
    expect(result.losses).toEqual([])
    expect(result.value).toBe('[report me](javascript:one) and ![report me too](vbscript:two)\n')
  })
})

/*
 * A label renders before its link's destination is probed on two targets, so
 * the row a label produced used to arrive first. Raised by codex review on this
 * change, and it also kept the wrong row under `maxRenderLosses: 1`.
 */
describe('a loss inside a link label', () => {
  const NESTED = '[![x](vbscript:two)](javascript:one)'
  const RAW_LABEL = '[a `x`{=latex} b](javascript:one)'

  it.each([
    ['html', carveToHtmlWithReport],
    ['markdown', carveToMarkdownWithReport],
  ] as const)('orders a denied image inside a denied link by position on %s', (_target, render) => {
    const result = render(NESTED)
    expect(result.losses.map((loss) => loss.pos?.startColumn)).toEqual([1, 2])
  })

  it.each([
    ['html', carveToHtmlWithReport],
    ['markdown', carveToMarkdownWithReport],
    ['ansi', carveToAnsiWithReport],
  ] as const)('reports the link before a raw inline in its label on %s', (_target, render) => {
    const result = render(RAW_LABEL)
    expect(codes(result.losses)).toEqual(['destination-denied', 'raw-format-dropped'])
  })

  it('keeps the first loss when the report is bounded to one entry', () => {
    const result = carveToMarkdownWithReport(NESTED, { maxRenderLosses: 1 })
    expect(result.totalLosses).toBe(2)
    expect(result.truncated).toBe(true)
    expect(result.losses[0]?.pos?.startColumn).toBe(1)
  })
})

/*
 * THE FAST PATH IS A SECOND RENDERER, and it blanks a denied destination with
 * no loss sink to report it on.
 *
 * `tryFastHtml` refuses anything it cannot borrow the layout for, and every
 * fixture above happens to be refused: `alert(1)` carries parentheses, `<...>`
 * an autolink, and corpus 536 an image (`![`). A plain single denied link is
 * refused by none of them, so it took the fast path and reported nothing -
 * the most ordinary shape of the construct, and the only one no fixture had.
 */
describe('a blanked destination on the HTML fast path', () => {
  const PLAIN = '[x](javascript:one)'

  it.each(SAFE_MODES)('reports a single denied link with allowRawHtml $allowRawHtml', (mode) => {
    const result = carveToHtmlWithReport(PLAIN, mode)
    expect(codes(result.losses)).toEqual(['destination-denied'])
    expect(result.totalLosses).toBe(1)
    expect(result.losses[0]?.message).toBe('Blanked a denied destination scheme')
  })

  it('emits the same bytes it always did, checked or not', () => {
    expect(carveToHtmlWithReport(PLAIN).value).toBe(carveToHtml(PLAIN))
    expect(carveToHtml(PLAIN)).toBe('<p><a href="">x</a></p>')
  })

  it('still reports nothing for a destination the denylist allows', () => {
    const allowed = '[x](https://example.com)'
    const result = carveToHtmlWithReport(allowed)
    expect(result.losses).toEqual([])
    expect(result.value).toBe(carveToHtml(allowed))
  })
})

/*
 * A DESTINATION EMPTIED BY CONTROL-STRIPPING WAS NEVER REFUSED.
 *
 * The Markdown writer normalizes before it probes (carve-js#893), so a
 * destination made of control characters alone arrives at the probe already
 * empty. Reading the emitted emptiness as a denial charged a row for a refusal
 * that did not happen, and disagreed with the HTML target on the same input.
 */
describe('a Markdown destination the denylist never refused', () => {
  const CONTROL_ONLY = '[a](\u0001)'

  it('reports nothing, and agrees with the HTML target', () => {
    expect(carveToMarkdownWithReport(CONTROL_ONLY).totalLosses).toBe(0)
    expect(carveToHtmlWithReport(CONTROL_ONLY).totalLosses).toBe(0)
  })

  it('reports nothing for a control-only image source either', () => {
    /* The source has to strip to NOTHING for the sink to see an empty emitted
     * value: `<SOH>x<STX>` strips to `x`, which never reaches the branch. */
    const result = carveToMarkdownWithReport('![a](\u0001\u0002)')
    expect(result.totalLosses).toBe(0)
    expect(result.value).toBe(carveToMarkdown('![a](\u0001\u0002)'))
  })

  it('STILL reports a denied scheme obfuscated with a control character', () => {
    /* The control strip is what makes the denylist obfuscation-resistant, so
     * the row has to survive it: `java<SOH>script:` is a refusal. */
    const result = carveToMarkdownWithReport('[a](java\u0001script:1)')
    expect(codes(result.losses)).toEqual(['destination-denied'])
    expect(result.value).toBe('[a]()\n')
  })
})

/*
 * A RESOLVER-PRODUCED DESTINATION THE RENDERER NEVER EMITS OWES NO ROW.
 *
 * The clause charges a row for each destination the denylist BLANKS. This
 * engine resolves a mention or tag inside the render pass
 * (`socialDestination` in src/render-html.ts), but when the denylist refuses
 * the result it returns null and the arm emits a `span` with no `href` at all.
 * Nothing is blanked, so nothing is owed - and a row here would put carve-js
 * one row ahead of carve-php, which reaches the same count by blanking in
 * `beforeRender` instead.
 */
describe('a resolver-produced destination the denylist refuses', () => {
  it('emits no destination and owes no row, for a mention or a tag', () => {
    const mention = carveToHtmlWithReport('@alice', { resolveMention: () => 'javascript:steal' })
    expect(mention.value).toBe('<p><span class="mention"><strong>@alice</strong></span></p>')
    expect(mention.losses).toEqual([])

    const tag = carveToHtmlWithReport('#topic', { resolveTag: () => 'vbscript:x' })
    expect(tag.value).toBe('<p><span class="tag"><strong>#topic</strong></span></p>')
    expect(tag.losses).toEqual([])
  })

  it('owes no row for a denied URL template either', () => {
    const result = carveToHtmlWithReport('@alice', { mentionUrl: 'javascript:{name}' })
    expect(result.value).toBe('<p><span class="mention"><strong>@alice</strong></span></p>')
    expect(result.losses).toEqual([])
  })

  it('still links an allowed mention, so the check above is not vacuous', () => {
    const result = carveToHtmlWithReport('@alice', { mentionUrl: 'https://s.example/{name}' })
    expect(result.value).toBe('<p><a class="mention" href="https://s.example/alice">@alice</a></p>')
    expect(result.losses).toEqual([])
  })
})

describe('the CLI on a blanked destination', () => {
  const makeIO = (stdin: string) => {
    let out = ''
    let err = ''
    return {
      io: {
        readStdin: async () => stdin,
        write: (s: string) => {
          out += s
        },
        writeErr: (s: string) => {
          err += s
        },
        readFile: () => {
          throw new Error('ENOENT')
        },
        writeFile: () => {},
      },
      get out() {
        return out
      },
      get err() {
        return err
      },
    }
  }

  it.each([[[]], [['--safe']]])('fails a strict render with %j', async (extra: string[]) => {
    const t = makeIO(`${LINK}\n`)
    expect(await run(['render', '--html', '--strict-losses', ...extra], t.io)).toBe(1)
    expect(t.err).toContain('destination-denied')
  })

  it('refuses to waive the code, which CARVE-P2-024 does not name', async () => {
    const t = makeIO(`${LINK}\n`)
    expect(await run(['render', '--html', '--allow-loss', 'destination-denied'], t.io)).toBe(2)
    expect(t.err).toContain("unknown loss code 'destination-denied'")
  })
})

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

import { describe, expect, it } from 'vitest'
import {
  carveToAnsiWithReport,
  carveToHtmlWithReport,
  carveToMarkdownWithReport,
  carveToPlainTextWithReport,
} from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

// CARVE-P2-024: Markdown numbers in decimal only, so an alpha or roman list
// keeps its start and delimiter and reports its style as lost.
describe('list-style-dropped on the Markdown target', () => {
  const styled: Array<[string, string, string]> = [
    ['a. one\na. two\n', '1. one\n2. two\n', 'lower-alpha'],
    ['A. one\n', '1. one\n', 'upper-alpha'],
    ['i. one\n', '1. one\n', 'lower-roman'],
    ['I. one\n', '1. one\n', 'upper-roman'],
    ['iv) x\nv) y\n', '4) x\n5) y\n', 'lower-roman'],
  ]

  for (const roundtrip of [false, true]) {
    for (const [source, markdown, style] of styled) {
      it(`reports ${style} for ${JSON.stringify(source)} (roundtrip ${roundtrip})`, () => {
        const result = carveToMarkdownWithReport(source, { roundtrip })
        expect(result.value).toBe(markdown)
        expect(result.losses).toHaveLength(1)
        const [loss] = result.losses
        expect(loss).toMatchObject({ code: 'list-style-dropped', target: 'markdown', nodeType: 'block', style })
        expect(loss).not.toHaveProperty('format')
        expect(loss!.pos).toBeDefined()
      })
    }
  }

  it('reports one loss per list, in document order', () => {
    const { losses } = carveToMarkdownWithReport('a. x\n\n> I. quoted\n\n- y\n\n  i. nested\n')
    expect(losses.map(loss => loss.code === 'list-style-dropped' && loss.style)).toEqual(['lower-alpha', 'upper-roman', 'lower-roman'])
  })

  it('reports nothing for a decimal list', () => {
    expect(carveToMarkdownWithReport('1. a\n2. b\n').losses).toEqual([])
    expect(carveToMarkdownWithReport('1) a\n', { roundtrip: true }).losses).toEqual([])
  })

  it('reports nothing on the HTML, plain and ANSI targets', () => {
    for (const render of [carveToHtmlWithReport, carveToPlainTextWithReport, carveToAnsiWithReport]) {
      expect(render('a. one\ni. two\n').losses).toEqual([])
    }
  })

  it('is accepted by --allow-loss', async () => {
    let out = ''
    let err = ''
    const io: CliIO = {
      readStdin: async () => 'a. one\n',
      write: (s) => { out += s },
      writeErr: (s) => { err += s },
      readFile: (p) => { throw new Error(`ENOENT: ${p}`) },
      writeFile: () => {},
    }
    expect(await run(['render', '--markdown', '--strict-losses', '--allow-loss', 'list-style-dropped'], io)).toBe(0)
    expect(out).toBe('1. one\n')
    expect(err).toBe('')
  })
})

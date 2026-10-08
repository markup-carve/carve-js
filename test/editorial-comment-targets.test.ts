import { describe, expect, it } from 'vitest'
import {
  carveToAnsiWithReport,
  carveToCarveWithReport,
  carveToHtmlWithReport,
  carveToMarkdownWithReport,
  carveToPlainTextWithReport,
} from '../src/index.js'
import { run } from '../src/cli.js'

const source = 'Text {+neu+} und {#Notiz#} hier.\n'
const message = 'Flattened an editorial comment into the surrounding text'
const pos = (startColumn: number, endColumn: number) => ({
  startLine: 1, endLine: 1, startColumn, endColumn, startOffset: startColumn - 1, endOffset: endColumn - 1,
})

describe('an editorial comment on each target (markup-carve/carve#2791)', () => {
  it('wraps the comment in a critic-comment span on Markdown, with no loss row', () => {
    expect(carveToMarkdownWithReport(source)).toEqual({
      value: 'Text <ins>neu</ins> und <span class="critic-comment">Notiz</span> hier.\n',
      losses: [],
      totalLosses: 0,
      truncated: false,
    })
  })

  it('runs the span content through the text escaper and never inline-parses it', () => {
    expect(carveToMarkdownWithReport('a {#x <b> & *y* b#} c\n').value)
      .toBe('a <span class="critic-comment">x \\<b> & \\*y\\* b</span> c\n')
  })

  it.each([
    ['plain', carveToPlainTextWithReport, 'Text neu und Notiz hier.\n'],
    ['ansi', carveToAnsiWithReport, 'Text \x1b[32m\x1b[4mneu\x1b[0m und Notiz hier.\n'],
  ] as const)('keeps %s output and reports one row per comment in document order', (target, render, value) => {
    expect(render(source)).toEqual({
      value,
      losses: [{ code: 'editorial-comment-flattened', target, nodeType: 'inline', message, pos: pos(18, 27) }],
      totalLosses: 1,
      truncated: false,
    })
    const two = render('{#a#} and {#bb#}\n')
    expect(two.losses).toEqual([
      { code: 'editorial-comment-flattened', target, nodeType: 'inline', message, pos: pos(1, 6) },
      { code: 'editorial-comment-flattened', target, nodeType: 'inline', message, pos: pos(11, 17) },
    ])
    expect(two.losses.every(loss => !('format' in loss))).toBe(true)
  })

  it('reports nothing on HTML and canonical Carve', () => {
    expect(carveToHtmlWithReport(source).losses).toEqual([])
    expect(carveToCarveWithReport(source).losses).toEqual([])
  })

  it('fails --strict-losses on plain and passes when the code is allowed', async () => {
    const io = (stdin: string) => {
      const sink = { out: '', err: '' }
      return {
        sink,
        io: {
          readStdin: async () => stdin,
          write: (s: string) => { sink.out += s },
          writeErr: (s: string) => { sink.err += s },
          readFile: () => { throw new Error('ENOENT') },
          writeFile: () => {},
        },
      }
    }
    const denied = io(source)
    expect(await run(['render', '--plain', '--strict-losses'], denied.io as never)).toBe(1)
    expect(denied.sink.err).toContain('editorial-comment-flattened')

    const allowed = io(source)
    expect(await run([
      'render', '--plain', '--strict-losses', '--allow-loss', 'editorial-comment-flattened',
    ], allowed.io as never)).toBe(0)
    expect(allowed.sink.out).toBe('Text neu und Notiz hier.\n')
    expect(allowed.sink.err).toBe('')
  })
})

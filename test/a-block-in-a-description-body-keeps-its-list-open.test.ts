import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string): string => html.split('\n').map(line => line.trim()).filter(Boolean).join('\n')

// A block in an open description's body, then a term nested there: a later `: ` at the
// outer term's column is a second description of that term (PART 0 S3, carve#4860).
describe('a block in a description body keeps its list open', () => {
  it('reads the triage reproduction as a second description', () => {
    const source = '- 0\n  :: t\n  : d\n    [^n]: e\n    :: u\n   : e\n'
    expect(normalize(carveToHtml(source))).toBe(
      '<ul>\n<li>0\n<dl>\n<dt>t</dt>\n<dd>\n<p>d</p>\n<dl>\n<dt>u</dt>\n</dl>\n</dd>\n<dd>e</dd>\n</dl>\n</li>\n</ul>',
    )
  })

  const blocks: Array<[string, string]> = [
    ['quote', '> q'],
    ['list', '- i'],
    ['ordered list', '1. i'],
    ['heading', '# h'],
    ['link definition', '[a]: /u'],
    ['footnote definition', '[^n]: e'],
    ['block attribute', '{.c}'],
    ['thematic break', '---'],
    ['table', '| a |'],
    ['code fence', '```\nc\n```'],
    ['colon fence', '::: box\n:::'],
  ]
  const hosts: Array<[string, (lines: string[]) => string]> = [
    ['marker-line term', lines => lines.map((l, i) => (i === 0 ? '- ' : '  ') + l).join('\n')],
    ['term below the item text', lines => ['- 0', ...lines.map(l => '  ' + l)].join('\n')],
    ['ordered item', lines => lines.map((l, i) => (i === 0 ? '1. ' : '   ') + l).join('\n')],
    ['quoted item', lines => lines.map((l, i) => (i === 0 ? '> - ' : '>   ') + l).join('\n')],
  ]
  for (const [hostName, host] of hosts) {
    it.each(blocks)(`${hostName}: a %s keeps the next description in the list`, (_name, block) => {
      const html = normalize(carveToHtml(host([':: t', ': d', ...block.split('\n').map(l => '  ' + l), '  :: u', ': e']) + '\n'))
      expect(html).toMatch(/<dt>u<\/dt>\n<\/dl>\n<\/dd>\n<dd>e<\/dd>\n<\/dl>/)
    })
  }

  it('ends the item at a below-column line after a fence closed in the body', () => {
    const source = '- :: t\n  : d\n    ```\n    c\n    ```\n    :: u\n : e\n'
    expect(normalize(carveToHtml(source))).toMatch(/<\/li>\n<\/ul>\n<p>: e<\/p>$/)
  })
})

import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

// carve#4861: a term is a one-line leaf like a heading, so with no `: ` line
// after it a document reads the same with `# t` in the term's place.
const leaf = (html: string, pattern: RegExp) => html.replace(/<section[^>]*>|<\/section>/g, '').replace(pattern, 'LEAF').replace(/\s+/g, '')
const asTerm = (html: string) => leaf(html, /<dl>\s*<dt>t<\/dt>\s*<\/dl>/g)
const asHeading = (html: string) => leaf(html, /<h1[^>]*>t<\/h1>/g)

const hosts = [['', ''], ['- ', '  '], ['1. ', '   '], ['> ', '> '], ['> - ', '>   '], ['- > ', '  > '], ['[^n]: ', '     '],
  [':: o\n: ', '  '], ['- x\n  ', '  '], ['  ', '  '], ['::: d\n', '']] as const
const followers = ['plain', 'wrapped *x*', '- x', '1. x', '> q', '# h', '---', '| a |', '```\nc\n```', '::: b\n:::', '^ cap', '+', '%% c\nplain',
  '{.a}\nplain', '[r]: /u', ':', '::', '\\: x', '  plain\nmore', '\nplain', '\tplain']
const prefixes = (continuation: string) => [continuation, '', ' ', continuation.replace(/>/g, ''), continuation + '  ']

const sources: Array<[string, string]> = []
for (const [lead, continuation] of hosts) for (const follower of followers) for (const prefix of prefixes(continuation)) for (const tail of ['', '\nend']) {
  const body = follower.split('\n').map((line) => prefix + line).join('\n') + tail + '\n'
  sources.push([`${lead}:: t\n${body}`, `${lead}# t\n${body}`])
}

it('reads a term like a heading in every host', () => {
  expect(sources.length).toBe(2310)
  const differ = sources.filter(([term, heading]) => asTerm(carveToHtml(term)) !== asHeading(carveToHtml(heading)))
  expect(differ.map(([term]) => term)).toEqual([])
})

it('renders the ticket rows', () => {
  expect(carveToHtml(':: A term that\nwraps\n: def\n')).toBe('<dl>\n  <dt>A term that</dt>\n</dl>\n<p>wraps\n: def</p>')
  expect(carveToHtml('- one\n  :: term\nwrapped\n')).toBe(
    '<ul>\n  <li>one\n    <dl>\n      <dt>term</dt>\n    </dl>\n  </li>\n</ul>\n<p>wrapped</p>')
  expect(carveToHtml(':: t\n  - x\n: d\n')).toBe('<dl>\n  <dt>t</dt>\n</dl>\n<ul>\n  <li>x\n: d</li>\n</ul>')
})

it('opens a description past the blank run and invisible lines, at any column', () => {
  const pair = '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>'
  for (const between of ['', '\n', '\n\n', '%% c\n', '  %% c\n', '[r]: /u\n', '  [r]: /u\n', '%% c\n\n']) {
    for (const separator of [': d', ' : d', '  : d', ':  d']) {
      expect(carveToHtml(`:: t\n${between}${separator}\n`), JSON.stringify(between + separator)).toBe(pair)
    }
  }
  for (const between of ['%%%\nc\n%%%\n', '  %%%\n  c\n  %%%\n']) {
    expect(carveToHtml(`:: t\n${between}: d\n`), JSON.stringify(between)).toBe(pair)
  }
})

it('reads a contentless separator as a plain line in every spelling', () => {
  for (const marker of [':', ': ', ':   ', ':\t', ': \t']) {
    expect(carveToHtml(`:: t\n${marker}\n`)).toBe('<dl>\n  <dt>t</dt>\n</dl>\n<p>:</p>')
  }
})

it('keeps a nested term and its description in a description inside an item', () => {
  expect(carveToHtml('- :: o\n  :  x\n     :: c\n     :  b\n')).toBe(
    '<ul>\n  <li>\n    <dl>\n      <dt>o</dt>\n      <dd>\n        <p>x</p>\n        <dl>\n          <dt>c</dt>\n          <dd>b</dd>\n        </dl>\n      </dd>\n    </dl>\n  </li>\n</ul>')
})

it('imports a wrapped Djot term onto its one line', () => {
  expect(djotToCarve(': term\n  continuation')).toBe('{loose}\n:: term continuation\n:  %%')
  // A hard break at the wrap collapses to a space, as the writer spells a break in a term.
  expect(djotToCarve(': a\\\n  b')).toBe('{loose}\n:: a b\n:  %%')
})

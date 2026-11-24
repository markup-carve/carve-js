import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

function findings(source) {
  return lint(source).filter((entry) => entry.code === 'braced-span-opener-as-text')
    .map((entry) => [entry.range.startOffset, entry.range.endOffset])
}

// carve#6538: the closer is a braced closer of the opener's own mark, later in the same leaf block.
describe('braced-span-opener-as-text: the closer of its own mark in its own leaf block', () => {
  const rows = [
    ['*a {/b*/}', [[3, 5]]],
    ['*a {/b* c\n\n*bold {/note*/} more*', [[17, 19]]],
    ['*a {/b* c\nd /} e', [[3, 5]]],
    ['*a {/b* c *}', []],
    ['*a {/b* c }', []],
    ['/a {*b/*}', [[3, 5]]],
    ['> *a {/b*\n> /}', [[5, 7]]],
    ['*a {/b* c\n\nd /}', []],
  ]
  for (const [source, expected] of rows) {
    it(JSON.stringify(source), () => expect(findings(source)).toEqual(expected))
  }

  it('reports each opener once, of every braced mark', () => {
    expect(findings('*a {/b {=c* d=} e/}')).toEqual([[3, 5], [7, 9]])
  })

  it('skips an escaped opener, an escaped closer and a closer in a code span', () => {
    expect(findings('*a \\{/b* /}')).toEqual([])
    expect(findings('*a {/b* \\/}')).toEqual([])
    expect(findings('*a {/b* `/}`')).toEqual([])
    expect(findings('*a {/b* \\\\/}')).toEqual([[3, 5]])
  })

  it('reads the closer in the caption of a code block and skips one in a comment or math', () => {
    expect(findings('```\nhi\n```\n^ *a {/b* c /}')).toEqual([[16, 18]])
    expect(findings('~~~\nhi\n~~~\n^ *a {/b* c /}')).toEqual([[16, 18]])
    expect(findings('*a {/b* {% /} %}')).toEqual([])
    expect(findings('*a {/b* $`/}`')).toEqual([])
  })

  it('skips an opener that a braced closer removed', () => {
    expect(findings('{*a {/b*} c/}')).toEqual([])
  })
})

const MARKS = ['*', '/', '_', '~', '=', '+', '-', '^', ',']

/** Each placement gives the source for bare parent `p`, opener mark `m` and another mark `w`, and whether it reports. */
const PLACEMENTS = [
  ['same line', (p, m) => `${p}a {${m}b${p} c ${m}}`, true],
  ['later line', (p, m) => `${p}a {${m}b${p} c\nd ${m}} e`, true],
  ['next paragraph', (p, m) => `${p}a {${m}b${p} c\n\nd ${m}}`, false],
  ['quote lines', (p, m) => `> ${p}a {${m}b${p}\n> ${m}}`, true],
  ['list item lines', (p, m) => `- ${p}a {${m}b${p} c\n  d ${m}}`, true],
  ['list item paragraphs', (p, m) => `- ${p}a {${m}b${p} c\n\n  d ${m}}`, false],
  ['other mark', (p, m, w) => `${p}a {${m}b${p} c ${w}}`, false],
  ['escaped closer', (p, m) => `${p}a {${m}b${p} c \\${m}}`, false],
  ['closer in code', (p, m) => `${p}a {${m}b${p} c \`${m}}\``, false],
  ['no closer', (p, m) => `${p}a {${m}b${p} c`, false],
  ['table cell', (p, m) => `| ${p}a {${m}b${p} c ${m}} |`, true],
  ['heading', (p, m) => `# ${p}a {${m}b${p} c ${m}}`, true],
  ['quote paragraphs', (p, m) => `> ${p}a {${m}b${p}\n>\n> ${m}}`, false],
]

describe('braced-span-opener-as-text: generated variants', () => {
  const cases = []
  for (const parent of ['*', '/']) {
    for (const mark of MARKS) {
      const other = mark === '/' ? '+' : '/'
      for (const [name, build, reports] of PLACEMENTS) cases.push([`${parent} ${mark} ${name}`, build(parent, mark, other), reports])
    }
  }
  it('has at least 200 variants', () => expect(cases.length).toBeGreaterThanOrEqual(200))
  it.each(cases)('%s', (_name, source, reports) => {
    const at = source.indexOf('{')
    expect(findings(source)).toEqual(reports ? [[at, at + 2]] : [])
  })
})

import { runInThisContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const TIME_BOUND_MS = 5000

// A sync loop outlives vitest's own timeout, so the bound has to interrupt it.
function renderBounded(source: string): string {
  const scope = globalThis as { carveBoundedRender?: () => string }
  scope.carveBoundedRender = () => renderHtml(parse(source))
  try {
    return runInThisContext('carveBoundedRender()', { timeout: TIME_BOUND_MS }) as string
  } finally {
    delete scope.carveBoundedRender
  }
}

describe('an indented term after a term on the item marker line', () => {
  it.each([
    [
      'a task item deep in descriptions',
      ` :: t
   : :: t
     : :: t
       : - [ ] :: t
           : a

             :: t
`,
    ],
    [
      'a task item above a table and a lazy bracket',
      `     - [ ] :: t
       : 1. :: t
            : 1. p

                 :: t
            a[^x
            ] b

       | t |
       +
       b
`,
    ],
  ])('returns for %s', (_name, source) => {
    expect(renderBounded(source)).toContain('<dt>t')
  })

  it.each([
    ['a task item', `- [ ] :: t\n  : a\n\n    :: t\n`, 2],
    ['a bullet item', `- :: t\n  : a\n\n    :: u\n`, 2],
  ])('reads the term as a term in %s', (_name, source, terms) => {
    expect(renderBounded(source).match(/<dt>/g)).toHaveLength(terms)
  })

  it('stays bounded when the indented term repeats', () => {
    const source = ` :: t
   : :: t
     : :: t
       : - [ ] :: t
           : a

${'             :: t\n\n'.repeat(4000)}`
    expect(renderBounded(source).match(/<dt>/g)!.length).toBeGreaterThan(4000)
  })
})

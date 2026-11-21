import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const found = (source) => lint(source)
  .filter((entry) => entry.code === 'deprecated-indented-line-under-heading')
  .map((entry) => `${entry.path} ${entry.range.startOffset}-${entry.range.endOffset}`)

describe('deprecated-indented-line-under-heading behind attribute lines (carve-js#5325)', () => {
  it('reads the marker line behind the attribute lines', () => {
    expect(found('{.a}\n# h\n  more\n')).toEqual(['/children/0 9-15'])
    expect(found('{.a}\n{#b}\n# h\n  more\n')).toEqual(['/children/0 14-20'])
    expect(found('> {.a}\n> # h\n>   more\n')).toEqual(['/children/0/children/0 13-21'])
    expect(found('{.a}\n%% c\n# h\n  more\n')).toEqual(['/children/1 14-20'])
    expect(found('{.a}\n  # h\n  more\n')).toEqual([])
  })

  it('leaves a heading without a continuation line alone', () => {
    expect(found('{.a}\n# h\n')).toEqual([])
    expect(found('{.a}\n# h\nmore\n')).toEqual([])
  })
})

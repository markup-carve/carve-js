import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const panels = '![A](a.png)\n^ (a) One\n\n![B](b.png)\n^ (b) Two\n'
const mismatches = (source) => lint(source).filter((entry) => entry.code === 'colon-fence-length-mismatch')

describe('C2-B-125 and C2-L-054: a closed figure group is no longer the innermost open div', () => {
  it('keeps the canonical outer-longer spelling lint-clean', () => {
    const source = `:::: note\n::: figure\n${panels}:::\n::::\n`
    expect(lint(source)).toEqual([])
  })

  it('does not warn on the parent closer when the inner figure fence was longer', () => {
    const source = `::: note\n:::: figure\n${panels}::::\n:::\n`
    expect(mismatches(source)).toEqual([])
  })

  it('finds the group closer before its caption', () => {
    const source = `:::: note\n::: figure\n${panels}:::\n^ Figure #: Both\n::::\n`
    expect(mismatches(source)).toEqual([])
  })

  it('keeps an unclosed group open when its child consumed the prior bare run', () => {
    const source = '::::: note\n:::: figure\n:::: inner\nx\n::::\n:::::\n'
    expect(mismatches(source).map((entry) => entry.message)).toEqual([
      expect.stringContaining('innermost 4-colon figure group'),
    ])
  })

  it('still warns when a bare run really differs from the innermost open div', () => {
    const source = ':::: note\n::: figure\n' + panels + '::::\n'
    expect(mismatches(source)).toHaveLength(1)
    expect(mismatches(source)[0].message).toContain('innermost 3-colon figure group')
  })
})

import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

const findings = (source: string) => lintCarve(source).filter((warning) =>
  warning.rule.startsWith('list-item-'),
)

describe('list item block indentation diagnostics', () => {
  it('reports a block that detached below the item content column', () => {
    const source = '1. item\n\n  # heading\n'
    expect(findings(source)).toMatchObject([{
      line: 3,
      column: 3,
      rule: 'list-item-body-detached',
    }])
  })

  it('reports an over-indented opener and names the #1701 legacy shape', () => {
    const source = '-{.x1} item\n\n       # heading\n'
    const [warning] = findings(source)
    expect(warning).toMatchObject({
      line: 3,
      column: 8,
      rule: 'list-item-block-overindented',
    })
    expect(warning!.message).toContain('former full-prefix column')
    expect(warning!.message).toContain('escape the opener')
  })

  it('reports ordinary over-indentation as ambiguous literal text', () => {
    const [warning] = findings('- item\n\n   > quote\n')
    expect(warning).toMatchObject({ rule: 'list-item-block-overindented', line: 3 })
    expect(warning!.message).not.toContain('former full-prefix column')
  })

  it('leaves exact-column blocks and ordinary indented prose alone', () => {
    expect(findings('- item\n\n  # heading\n')).toEqual([])
    expect(findings('- item\n\n   ordinary prose\n')).toEqual([])
  })

  it('reports UTF-16 offsets against the caller’s CRLF source', () => {
    const source = '1. item\r\n\r\n  # heading\r\n'
    const [warning] = findings(source)
    expect(warning).toMatchObject({ rule: 'list-item-body-detached', line: 3, column: 3 })
    expect(source.slice(warning!.start, warning!.end)).toBe('#')
  })

  it('does not double-report an over-indented fence with the generic fence rule', () => {
    const rules = lintCarve('- item\n\n   ```\n   code\n   ```\n').map((warning) => warning.rule)
    expect(rules.filter((rule) => rule === 'list-item-block-overindented')).toHaveLength(2)
    expect(rules).not.toContain('fence-delimiter-indentation')
  })

  it('uses the innermost item opened on the marker line', () => {
    expect(findings('- - item\n\n    # exact\n')).toEqual([])
    expect(findings('- - item\n\n     # over\n')).toMatchObject([
      { rule: 'list-item-block-overindented', line: 3 },
    ])
  })

  it('measures authored indentation after quote prefixes', () => {
    expect(findings('> - item\n>\n>   # exact\n')).toEqual([])
    expect(findings('> - item\n>\n>    # over\n')).toMatchObject([
      { rule: 'list-item-block-overindented', line: 3, column: 6 },
    ])
  })

  it('uses bare-marker columns for task and ordered items, including tabs', () => {
    expect(findings('- [x] item\n\n  # exact\n')).toEqual([])
    expect(findings('- [x] item\n\n\t# over\n')).toMatchObject([
      { rule: 'list-item-block-overindented', line: 3, column: 2 },
    ])
    expect(findings('10. item\n\n   # detached\n')).toMatchObject([
      { rule: 'list-item-body-detached', line: 3 },
    ])
  })

  it('covers definitions but not escaped openers, comments, or prose', () => {
    expect(findings('- item\n\n   [r]: /url\n')).toMatchObject([
      { rule: 'list-item-block-overindented', line: 3 },
    ])
    expect(findings('- item\n\n   \\# literal\n')).toEqual([])
    expect(findings('- item\n\n   %% comment\n')).toEqual([])
  })

  it('keeps a long flat migration scan linear enough for the lint path', () => {
    const source = Array.from({ length: 3000 }, (_, index) =>
      `-{.x${index}} item\n   # heading\n`,
    ).join('')
    expect(findings(source)).toHaveLength(3000)
  })
})

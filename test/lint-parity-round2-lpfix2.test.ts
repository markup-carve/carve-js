import { describe, expect, it } from 'vitest'
import { lint } from '../lint/lint.ts'

const cases: readonly [number, string, string, readonly [number, number][]][] = [
  [5183, 'block-opener-without-blank-line', 'c\n> %%%', [[2, 3]]],
  [5184, 'colon-fence-length-mismatch', '1. ::::\n:::', []],
  [5185, 'colon-fence-length-mismatch', '{.c}\n::::\n:::', [[10, 13]]],
  [5186, 'colon-fence-length-mismatch', '   :::\n     :::: warning\n   :::', [[28, 31]]],
  [5187, 'definition-in-container', '# H\n [a]: u', []],
  [5188, 'description-separator-below-content-column', '> - :: term\n> :', [[14, 15]]],
  [5189, 'unattached-caption', '*[HTML]: Hyper\n> ^ Caption', [[17, 26]]],
  [5190, 'github-alert-marker', '> a. > [!NOTE]', [[7, 14]]],
  [5191, 'frontmatter-shaped-thematic-break', '---\t\n$$', [[0, 7]]],
]

function ranges(source: string, rule: string): [number, number][] {
  return lint(source).filter((finding) => finding.code === rule)
    .map((finding) => [finding.range!.startOffset, finding.range!.endOffset])
}

describe('round two lint parity ticket inputs', () => {
  for (const [ticket, rule, source, expected] of cases) {
    it(`#${ticket}: ${rule}`, () => {
      expect(ranges(source, rule)).toEqual(expected)
    })
  }

  it('keeps colon fences scoped to their live parent when a quote ends', () => {
    expect(ranges('> :::\n::::', 'colon-fence-length-mismatch')).toEqual([])
    expect(ranges('> :::\n\n::::', 'colon-fence-length-mismatch')).toEqual([])
  })

  it('recognizes an attributed fence without changing the plain fence case', () => {
    expect(ranges('::::\n:::', 'colon-fence-length-mismatch')).toEqual([[5, 8]])
    expect(ranges('{#id}\n::::\n:::', 'colon-fence-length-mismatch')).toEqual([[11, 14]])
  })

  it('keeps a figure-group fence in the live colon-container search', () => {
    const panels = '![A](a.png)\n^ (a) One\n\n![B](b.png)\n^ (b) Two\n'
    expect(ranges(`:::: note\n::: figure\n${panels}::::\n`, 'colon-fence-length-mismatch')).toHaveLength(1)
    expect(ranges(`{.c}\n:::: note\n::: figure\n${panels}::::\n`, 'colon-fence-length-mismatch')).toHaveLength(1)
  })

  it('limits colon candidates to the owning quote or item under carve#6194', () => {
    expect(ranges('::::\n> :::', 'colon-fence-length-mismatch')).toEqual([])
    expect(ranges('::::\n- a\n\n  :::  ', 'colon-fence-length-mismatch')).toEqual([])
    expect(ranges('::::\n2) - > :::\n     :::', 'colon-fence-length-mismatch')).toEqual([])
  })

  it('does not lint a colon run that remains paragraph text under carve#6201', () => {
    expect(ranges('::::\npara\n> :::', 'colon-fence-length-mismatch')).toEqual([])
  })

  it('keeps heading continuations out of the definition warning', () => {
    for (const mark of ['#', '##', '=']) {
      expect(ranges(`${mark} H\n [a]: u`, 'definition-in-container')).toEqual([])
    }
  })

  it('reads a definition shape behind a quote owned by a description', () => {
    const source = ':: t\n: ````\n      ````\n  > *[x1]:\n>   [^n]: : text'
    expect(ranges(source, 'definition-in-container')).toEqual([[38, 43]])
  })

  it('does not read a lazy quote marker as a description separator', () => {
    expect(ranges('\t:: more\n> ::', 'description-separator-below-content-column')).toEqual([])
  })

  it('reports a caption-shaped line after a footnote with a directive', () => {
    expect(ranges('[^f]: {{ x.crv#s }}\n^ x', 'unattached-caption')).toEqual([[20, 23]])
  })

  it('accepts the permitted frontmatter opener whitespace', () => {
    for (const whitespace of [' ', '\t', ' \t']) {
      expect(ranges(`---${whitespace}\n$$`, 'frontmatter-shaped-thematic-break')).toHaveLength(1)
    }
  })
})

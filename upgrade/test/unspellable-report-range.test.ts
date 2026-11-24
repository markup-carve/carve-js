import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('U-439: an unclosed 0.1 value that starts with a space and a backtick', () => {
  it.each([
    ['a `` `b\n', 2],
    ['a !`` `b\n', 2],
    ['a $`` `b\n', 2],
  ])('C2-W-077 reports the run instead of closing it: %j', (source, startOffset) => {
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-439', class: 'report',
      range: { startOffset, endOffset: source.trimEnd().length } }))
    expect(result.records.some((record) => record.entry === 'U-258')).toBe(false)
    expect(canWriteUpgrade(result)).toBe(false)
  })
})

describe('U-258: an unclosed 0.1 value that starts with a line break', () => {
  it.each([
    ['a ``\nb`\n', 'a ``\nb` ``\n'],
    ['a !``\nb`\n', 'a !``\nb` ``\n'],
    ['a $``\nb`\n', 'a $``\nb` ``\n'],
    ['- ```\n+  y\n+   ```\n``\n', '- ```\n+  y\n+   ```\n`` ```\n'],
    ['a ``\nb\n', 'a ``\nb``\n'],
  ])('C2-W-077 pads only the closing side: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
  })
})

describe('U-061: a delimited table that 0.1 left a code block', () => {
  it.each([
    ['{table}\n```csv\na,"b\nc,d\n```\n', 1, 0],
    ['{table}\n\n```csv\n- "bad\n  ```\n', 1, 0],
    ['p\n\n{.c}\n{table}\n```csv\na,"b\n```\n', 3, 3],
  ])('C2-B-180 reports from the attribute line through the fence: %j', (source, line, startOffset) => {
    const result = upgrade(source)
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-061', class: 'report', line,
      range: { startOffset, endOffset: source.trimEnd().length } }))
    expect(canWriteUpgrade(result)).toBe(false)
  })
})

describe('U-440: an empty unclosed literal-text run', () => {
  it.each([
    ['x!``\n', 'x\n'],
    ['- a!``\n', '- a\n'],
    ['> b!`\n', '> b\n'],
    ['| x | !`` |\n', '| x |  |\n'],
  ])('removes the run 0.1 wrote as nothing: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-440')
  })

  it.each(['a !``\n', '!``\n', '# !``\n'])('U-439 reports the run where removing it changes the HTML: %j', (source) => {
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.records.map((record) => record.entry)).toContain('U-439')
    expect(result.records.map((record) => record.entry)).not.toContain('U-440')
  })
})

describe('the explanation of an empty run cites the entry that reported it', () => {
  it.each([['a `\n', 'U-439'], ['a $`\n', 'U-396']])('%j', (source, entry) => {
    const result = upgrade(source)
    expect(result.check).toBe('explained')
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'upgrade-difference',
      message: `the HTML matches after the declared transformations of ${entry}` }))
  })
})

describe('U-441: a 0.1 code span padded on both sides', () => {
  it.each([
    ['a ` x ` b\n', 'a `x` b\n'],
    ['> a ` x\n> y ` b\n', '> a `x\n> y` b\n'],
    ['a `` x` `` b\n', 'a ``x` `` b\n'],
    ['$` y ` !` z ` ` w `{=html}\n', '$`y` !`z` `w`{=html}\n'],
    ['| a ` x ` |\n', '| a `x` |\n'],
  ])('C2-I-016 removes the pads 0.1 removed: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
  })

  it.each([
    ['a ``  `x `` b\n', 2, 11],
    ['a ` ``b` c\n', 2, 8],
  ])('C2-W-077 reports a 0.1 value that starts with a space and a backtick: %j', (source, startOffset, endOffset) => {
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-441', class: 'report', range: { startOffset, endOffset } }))
    expect(canWriteUpgrade(result)).toBe(false)
  })

  it.each(['> x ` `` y\n', '| x ` `` y |\n'])('U-439 reports an unclosed run with no spelling in a quote or a cell: %j', (source) => {
    const result = upgrade(source)
    expect(result.records.some((record) => record.entry === 'U-439' && record.class === 'report')).toBe(true)
    expect(canWriteUpgrade(result)).toBe(false)
  })
})

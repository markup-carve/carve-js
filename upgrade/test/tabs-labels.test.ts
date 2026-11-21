import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/upgrade.ts'
import { sameHost } from '../src/tabs.ts'

// C2-X-056 and spec/0.2/UPGRADING.md U-412 to U-417: carve-js#5079.
describe('0.1 tab label spellings', () => {
  it.each([
    ['U-412', 'a bracket label',
      ':::: tabs\n::: tab [Install]\nRun it.\n:::\n::::\n',
      ':::: tabs\n::: tab "Install"\nRun it.\n:::\n::::\n'],
    ['U-412', 'a bracket label on a longer colon run',
      '::::: tabs\n:::: tab [Install]\nRun it.\n::::\n:::::\n',
      '::::: tabs\n:::: tab "Install"\nRun it.\n::::\n:::::\n'],
    ['U-412', 'every tab of a group',
      ':::: tabs\n::: tab [A]\na\n:::\n\n::: tab [B]\nb\n:::\n::::\n',
      ':::: tabs\n::: tab "A"\na\n:::\n\n::: tab "B"\nb\n:::\n::::\n'],
    ['U-412', 'a bracket label inside a list item',
      '- :::: tabs\n  ::: tab [A]\n  a\n  :::\n  ::::\n',
      '- :::: tabs\n  ::: tab "A"\n  a\n  :::\n  ::::\n'],
    ['U-412', 'a bracket label inside a quote',
      '> :::: tabs\n> ::: tab [A]\n> a\n> :::\n> ::::\n',
      '> :::: tabs\n> ::: tab "A"\n> a\n> :::\n> ::::\n'],
    ['U-412', 'a bracket label that 0.1 kept literal',
      ':::: tabs\n::: tab [B *x*]\nb\n:::\n::::\n',
      ':::: tabs\n::: tab "B \\*x\\*"\nb\n:::\n::::\n'],
    ['U-412', 'a bracket label next to a first heading, which stays content',
      ':::: tabs\n::: tab [A]\n# H\nb\n:::\n::::\n',
      ':::: tabs\n::: tab "A"\n# H\nb\n:::\n::::\n'],
    ['U-413', 'a bare label attribute',
      ':::: tabs\n{label=Install}\n::: tab\nRun it.\n:::\n::::\n',
      ':::: tabs\n::: tab "Install"\nRun it.\n:::\n::::\n'],
    ['U-413', 'a quoted label attribute',
      ':::: tabs\n{label="Two words"}\n::: tab\nRun it.\n:::\n::::\n',
      ':::: tabs\n::: tab "Two words"\nRun it.\n:::\n::::\n'],
  ])('%s rewrites %s', (id, _name, source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.records).toContainEqual(expect.objectContaining({ entry: id, class: 'rewrite', line: 2 + Number(id === 'U-413') }))
    expect(result.check).toBe('explained')
    expect(canWriteUpgrade(result)).toBe(true)
    expect(sameHost(source, result.output)).toBe(true)
  })

  it('rewrites a bracket label and a label attribute in one group', () => {
    const source = ':::: tabs\n{label=A}\n::: tab\na\n:::\n\n::: tab [B]\nb\n:::\n::::\n'
    const result = upgrade(source)
    expect(result.output).toBe(':::: tabs\n::: tab "A"\na\n:::\n\n::: tab "B"\nb\n:::\n::::\n')
    expect(result.records.filter((record) => record.class === 'rewrite').map((record) => [record.entry, record.line]))
      .toEqual([['U-413', 3], ['U-412', 7]])
  })

  it('rewrites a group nested in a tab', () => {
    const source = ':::::: tabs\n::::: tab [Outer]\n:::: tabs\n::: tab [Inner]\nx\n:::\n::::\n:::::\n::::::\n'
    const result = upgrade(source)
    expect(result.output).toBe(':::::: tabs\n::::: tab "Outer"\n:::: tabs\n::: tab "Inner"\nx\n:::\n::::\n:::::\n::::::\n')
    expect(result.check).toBe('explained')
  })

  it.each([
    ['U-413', 'a label attribute beside another attribute', ':::: tabs\n{label=Install .x}\n::: tab\nRun.\n:::\n::::\n'],
    ['U-414', 'a first heading', ':::: tabs\n::: tab\n# Install\nRun it.\n:::\n::::\n'],
    ['U-415', 'a class alone', ':::: tabs\n{.install}\n::: tab\nRun it.\n:::\n::::\n'],
    ['U-415', 'no label source', ':::: tabs\n::: tab\nRun it.\n:::\n::::\n'],
    ['U-412', 'a quoted title, which was panel content in 0.1', ':::: tabs\n::: tab "Note"\nRun it.\n:::\n::::\n'],
    ['U-417', 'a class on the group', '{.custom-tabs}\n:::: tabs\n::: tab [A]\nRun it.\n:::\n::::\n'],
  ])('%s reports %s with its source range', (id, _name, source) => {
    const result = upgrade(source)
    const record = result.records.find((item) => item.entry === id && item.class === 'report')
    expect(record?.range).toBeDefined()
    expect(source.slice(record!.range!.startOffset, record!.range!.endOffset)).toMatch(/^:{3,} tabs?/u)
    expect(result.records.filter((item) => item.entry === id)).toHaveLength(1)
  })

  it.each([
    ['a tab class', ':::: tabs\n{.tab}\n::: [Install]\nRun it.\n:::\n::::\n'],
    ['a block that is not a tab', ':::: tabs\n::: tab [A]\na\n:::\n\nstray\n::::\n'],
  ])('blocks %s, which the 0.2 tabs extension does not claim', (_name, source) => {
    const result = upgrade(source)
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'upgrade-mismatch', status: 'no mapped row' }))
    expect(canWriteUpgrade(result)).toBe(false)
  })

  it('U-427 rewrites the verified class-form tabs row', () => {
    const source = '{.tabs}\n::::\n{.tab}\n::: [Install]\nRun it.\n:::\n::::\n'
    const result = upgrade(source)
    expect(result.output).toBe(':::: tabs\n::: tab "Install"\nRun it.\n:::\n::::\n')
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-427', class: 'rewrite' }))
    expect(canWriteUpgrade(result)).toBe(true)
  })

  it('leaves a document without tabs alone', () => {
    const source = '::: note [A]\nx\n:::\n'
    expect(upgrade(source).records.some((record) => /^U-41[2-7]$/u.test(record.entry))).toBe(false)
  })
})

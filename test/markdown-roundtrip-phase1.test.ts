import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToMarkdown, migrateMarkdown, parse } from '../src/index.js'
import { carrierPayload } from '../src/import/markdown/carrier-markers.js'

const tree = (source: string) =>
  JSON.parse(
    JSON.stringify(parse(source, { positions: false }), (key, value) => (key === 'srcByteLength' ? undefined : value)),
  )

it.each([
  ':: Carve\n',
  ':: Carve\n:: Djot\n: Markup languages.\n',
  ':: Carve\n:: Djot\n',
  ':: First\n: Definition\n:: Last\n',
])('restores definition terms with zero or shared definitions: %j', (source) => {
  const markdown = carveToMarkdown(source, { roundtrip: true })
  const result = migrateMarkdown(markdown)
  expect(result.report.diagnostics.filter((d) => d.code === 'carrier-markers-damaged')).toEqual([])
  expect(tree(result.value)).toEqual(tree(source))
  expect(markdown.match(/<!-- carve: :: /g)).toHaveLength(
    source.split('\n').filter((line) => line.startsWith(':: ')).length,
  )
  expect(markdown.match(/<!-- carve: -->/g)).toHaveLength(1)
})

it.each([
  '222-a-tab-as-the-first-character-of-a-definition-term',
  '227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace',
  '227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace-2',
  '116-fence-opener-with-a-nested-list-body-inside-a-list-item-6',
  '279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-5',
  '279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-10',
  '279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-11',
  '160-indented-colon-fence-blocks-open-4',
  '170-headings-inside-containers-are-not-wrapped',
])('reads the corpus repro without a damaged marker set: %s', (slug) => {
  const source = readFileSync(new URL(`../spec/tests/corpus/${slug}.crv`, import.meta.url), 'utf8')
  const result = migrateMarkdown(carveToMarkdown(source, { roundtrip: true }))
  expect(result.report.diagnostics.filter((d) => d.code === 'carrier-markers-damaged')).toEqual([])
  // These existing losses are outside term grouping and fence ownership.
  const remainingLosses: Record<string, string> = {
    '227-a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace':
      ':: term\n: {empty}\n\nsee [t][r]\n\n[r]: /u\n',
    '279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-5': '- x\n  :::\n  a\n  \\- m\n  b\n  :::\n',
  }
  expect(tree(result.value)).toEqual(tree(remainingLosses[slug] ?? source))
})

it('distinguishes a bare div opener from its single closer at each host', () => {
  for (const source of ['::: \n:::\n', '> :::\n> :::\n', '- :::\n  :::\n', '::: note\n::::\n::::\n:::\n']) {
    const markdown = carveToMarkdown(source, { roundtrip: true })
    const payloads = markdown.split('\n').flatMap((line) => {
      const payload = carrierPayload(line.slice(line.indexOf('<!-- carve:')))
      return payload === undefined ? [] : [payload]
    })
    // CARVE-P11-063: a bare opener is `:::` alone, the same bytes as a closer.
    expect(payloads.filter((payload) => /\s$/.test(payload))).toEqual([])
    const result = migrateMarkdown(markdown)
    expect(result.report.diagnostics.filter((d) => d.code === 'carrier-markers-damaged')).toEqual([])
    expect(tree(result.value)).toEqual(tree(source))
  }
})

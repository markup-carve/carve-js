// Measures the HTML hub route of Markdown, GFM and Djot import against the 0.1 importers on the foreign test suites.
// Needs the 0.1 engine build (`tsc -p upgrade/engine-0.1/tsconfig.json`). Each route is judged by its own engine's
// render against the suite's reference HTML; a case is a gap when 0.1 renders it the same and the hub does not.
import { carveToHtml, djotToCarve, markdownToCarve } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { importDocument, type Format } from '../src/index.ts'
import { verdict, type HtmlVerdict } from './compare-html.ts'
import { commonmarkCases, djotCases, gfmCases, type Case } from './suites.ts'

const RANK: Record<HtmlVerdict, number> = { same: 2, 'same-text': 1, different: 0 }

function judge(expected: string, run: () => string): HtmlVerdict {
  try { return verdict(expected, run()) } catch { return 'different' }
}

function legacy(format: Format, input: string): string {
  const source = format === 'djot' ? djotToCarve(input) : markdownToCarve(input)
  return carveToHtml(source, { rawHtml: true } as Parameters<typeof carveToHtml>[1])
}

interface Row { section: string, legacy: number, hub: number, cases: number, gaps: string[], gains: string[] }

function measure(title: string, format: Format, cases: Case[]): string[] {
  const rows = new Map<string, Row>()
  for (const entry of cases) {
    const before = judge(entry.html, () => legacy(format, entry.input))
    const after = judge(entry.html, () => render(importDocument(entry.input, { from: format }).source, { rawHtml: true }))
    const row = rows.get(entry.section) ?? { section: entry.section, legacy: 0, hub: 0, cases: 0, gaps: [], gains: [] }
    row.cases++
    if (before === 'same') row.legacy++
    if (after === 'same') row.hub++
    if (RANK[after] < RANK[before]) row.gaps.push(entry.id)
    if (RANK[after] > RANK[before]) row.gains.push(entry.id)
    rows.set(entry.section, row)
  }
  const lines = [`## ${title}`, '', '| Section | Cases | 0.1 same | Hub same | Hub worse | Hub better |',
    '| --- | ---: | ---: | ---: | ---: | ---: |']
  let total = { cases: 0, legacy: 0, hub: 0, gaps: 0, gains: 0 }
  for (const row of rows.values()) {
    const section = row.section.replaceAll('|', '\\|')
    lines.push(`| ${section} | ${row.cases} | ${row.legacy} | ${row.hub} | ${row.gaps.length} | ${row.gains.length} |`)
    total = { cases: total.cases + row.cases, legacy: total.legacy + row.legacy, hub: total.hub + row.hub,
      gaps: total.gaps + row.gaps.length, gains: total.gains + row.gains.length }
  }
  lines.push(`| total | ${total.cases} | ${total.legacy} | ${total.hub} | ${total.gaps} | ${total.gains} |`, '', 'Hub worse:', '')
  for (const row of rows.values()) if (row.gaps.length > 0) lines.push(`- ${row.section}: ${row.gaps.join(', ')}`)
  return [...lines, '']
}

const only = process.argv[2]
const suites: [string, Format, () => Case[]][] = [['CommonMark', 'markdown', commonmarkCases], ['GFM', 'gfm', gfmCases],
  ['Djot', 'djot', djotCases]]
const out: string[] = []
for (const [title, format, cases] of suites) if (only === undefined || only === format) out.push(...measure(title, format, cases()))
process.stdout.write(`${out.join('\n')}\n`)

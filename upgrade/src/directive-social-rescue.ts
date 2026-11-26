import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

interface Rescue { output: string; record: ReportRecord }

const DIRECTIVE = /\{\{[^\n{}]*\}\}/gu
const SOCIAL = /class="(?:mention|tag)"/gu

function socialCount(source: string): number {
  return (html02(source, false).match(SOCIAL) ?? []).length
}

/**
 * U-290 (C2-N-002, C2-H-133): a directive 0.2 reads as text turns its option names into mentions or
 * tags. A span is escaped only when that lowers the social count, so a directive 0.2 still expands is
 * never touched.
 */
export function rescueDirectiveSocial(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!output.includes('{{')) return null
  let current = output
  let count = socialCount(current)
  if (count === 0) return null
  for (const match of [...output.matchAll(DIRECTIVE)].reverse()) {
    const escaped = match[0].replace(/(^|[ \t])([@#])/gu, '$1\\$2')
    if (escaped === match[0] || match.index === undefined) continue
    const candidate = current.slice(0, match.index) + escaped + current.slice(match.index + match[0].length)
    const next = socialCount(candidate)
    if (next >= count) continue
    current = candidate
    count = next
  }
  if (current === output || !compareHtmlExact(html01(input), html02(current, false)).equal) return null
  return { output: current, record: recordOf('U-290', mismatch.line,
    'the option names of a directive 0.2 reads as text were escaped so they stay text') }
}

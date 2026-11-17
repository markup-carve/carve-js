import map from '../../v2/data/upgrade-map.json' with { type: 'json' }
import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

const REWRITE_IDS = new Set([
  'U-265', 'U-267', 'U-273', 'U-274', 'U-275', 'U-276', 'U-277', 'U-278', 'U-280', 'U-281',
  'U-284', 'U-285', 'U-286', 'U-290', 'U-300', 'U-304', 'U-305', 'U-340', 'U-365', 'U-366',
  'U-367', 'U-368', 'U-369',
])

const BY_SOURCE = new Map(map.source.filter((row) => REWRITE_IDS.has(row.id)).map((row) => [row.from, row]))

/** Exact catalog examples have a promised spelling; accept it only when both renderers confirm it. */
export function mappedRewrite(input: string): { output: string; record: ReportRecord } | null {
  const row = BY_SOURCE.get(input)
  if (row === undefined || row.to === input) return null
  try {
    if (!compareHtmlExact(html01(input), html02(row.to, false)).equal) return null
  } catch { return null }
  return { output: row.to, record: recordOf(row.id, 1, row.meaning02) }
}

// U-431: 0.1 split a hyphen run into as many em dashes as leave an even rest; C2-I-111 writes one em
// dash and then en dashes. The dash characters 0.1 wrote keep its HTML; the complete HTML check decides.
import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

function dashes01(length: number): string {
  for (let em = Math.floor(length / 3); em >= 0; em--) {
    const rest = length - em * 3
    if (rest % 2 === 0) return '—'.repeat(em) + '–'.repeat(rest / 2)
  }
  return '-'.repeat(length)
}

function dashes02(length: number): string {
  if (length % 3 === 0) return '—'.repeat(length / 3)
  if (length % 2 === 0) return '–'.repeat(length / 2)
  return `—${dashes02(length - 3)}`
}

export function rescueDashRun(input: string, output: string, mismatch: ReportRecord): { output: string; record: ReportRecord } | null {
  let changed = false
  const candidate = output.replace(/(?<![-\\<])-{5,}(?![->])/gu, (run) => {
    const old = dashes01(run.length)
    if (old === dashes02(run.length) || old.includes('-')) return run
    changed = true
    return old
  })
  if (!changed) return null
  try {
    if (!compareHtmlExact(html01(input), html02(candidate, false)).equal) return null
  } catch { return null }
  return { output: candidate, record: recordOf('U-431', mismatch.line,
    'a hyphen run that C2-I-111 splits differently is written as the dashes 0.1 wrote') }
}

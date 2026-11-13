import entryTable from '../data/entries.json' with { type: 'json' }

export type EntryClass = 'rewrite' | 'escape' | 'report' | 'none'

export interface Entry {
  id: string
  name: string
  class: EntryClass
  lint: string[]
}

/** One line of the report. `class` is the class of the entry, or what the self-check found. */
export interface ReportRecord {
  entry: string
  class: EntryClass | 'summary' | 'mismatch'
  /** Line of the input, from 1. 0 for a record about the whole file. */
  line: number
  message: string
  lint?: string
}

export const ENTRIES: readonly Entry[] = entryTable.entries as Entry[]

/**
 * Entries of the tool itself, for cases the specification does not decide and the tool keeps as
 * 0.1 rendered them. They are not part of the contract.
 */
export const EXTENSIONS: readonly Entry[] = entryTable.extensions as Entry[]

const BY_ID = new Map([...ENTRIES, ...EXTENSIONS].map((entry) => [entry.id, entry]))

export function entryOf(id: string): Entry {
  const entry = BY_ID.get(id)
  if (entry === undefined) throw new Error(`no contract entry ${id}`)
  return entry
}

/** A record of `id` at `line`, with the class and the first lint rule of the entry. */
export function recordOf(id: string, line: number, message: string): ReportRecord {
  const entry = entryOf(id)
  const record: ReportRecord = { entry: id, class: entry.class, line, message }
  if (entry.lint[0] !== undefined) record.lint = entry.lint[0]
  return record
}

/** Whether `record` asks for a person: a report entry or an unexplained difference. */
export function needsPerson(record: ReportRecord): boolean {
  return record.class === 'report' || record.class === 'mismatch'
}

export function formatRecord(file: string, record: ReportRecord): string {
  const place = record.line > 0 ? `${file}:${record.line}` : file
  const lint = record.lint === undefined ? '' : ` [${record.lint}]`
  return `${place}: ${record.entry} ${record.class}: ${record.message}${lint}`
}

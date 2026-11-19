// C2-B-230: the bodies that `body-rows`, `body-header-rows` and `body-header-cols` split the rows between the head and
// the foot into. The block tree reads it to end row spans at a body (C2-B-174), the tree to make one `table_body` each.
import { type Attributes } from './ast-attributes.ts'
import { trimSpaces } from './source.ts'

export const BODY_KEYS = ['body-rows', 'body-header-rows', 'body-header-cols'] as const

export interface BodyPartition {
  /** The data rows of each body. */
  data: number[]
  /** The rows of header cells that lead each body. */
  header: number[]
  /** The `rowHeadColumns` of each body, or null for an empty entry. */
  columns: (number | null)[]
}

function isDigits(entry: string): boolean {
  return /^[0-9]+$/u.test(entry)
}

/** The entries of a list, each trimmed of spaces, or null where one is not `allowed`. An empty value has none. */
function entries(value: string, allowEmpty: boolean): string[] | null {
  if (trimSpaces(value) === '' && !allowEmpty) return []
  const out = value.split(',').map(trimSpaces)
  return out.every((entry) => isDigits(entry) || (allowEmpty && entry === '')) ? out : null
}

function valueOf(attributes: Attributes | null, name: string): string | null {
  return attributes?.keyValues.find((pair) => pair[0] === name)?.[1] ?? null
}

/** The partition of the `between` rows between the head and the foot, or null where the keys have no effect. */
export function bodyPartition(attributes: Attributes | null, between: number): BodyPartition | null {
  const rows = valueOf(attributes, 'body-rows')
  if (rows === null) return null
  const data = entries(rows, false)
  if (data === null) return null
  const headerValue = valueOf(attributes, 'body-header-rows')
  const columnsValue = valueOf(attributes, 'body-header-cols')
  const header = headerValue === null ? data.map(() => '0') : entries(headerValue, false)
  const columns = columnsValue === null ? data.map(() => '') : entries(columnsValue, true)
  if (header === null || columns === null || header.length !== data.length || columns.length !== data.length) return null
  const out: BodyPartition = {
    data: data.map(Number), header: header.map(Number), columns: columns.map((entry) => (entry === '' ? null : Number(entry))),
  }
  let total = 0
  for (let at = 0; at < data.length; at++) total += out.data[at]! + out.header[at]!
  return total === between ? out : null
}

/** The row index, counted from the first row below the head, at which each body starts. */
export function bodyStarts(partition: BodyPartition): number[] {
  const starts: number[] = []
  let at = 0
  for (let body = 0; body < partition.data.length; body++) {
    starts.push(at)
    at += partition.data[body]! + partition.header[body]!
  }
  return starts
}

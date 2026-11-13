// The reader side of the source-layout record (C2-L-007 to C2-L-012, C2-L-020, C2-L-027): a record
// that the document refuses fails with a typed error that names the field and what was wrong.
import { isRecord } from './ast.ts'
import { LAYOUT_VERSION, type SourceLayout } from './layout.ts'
import { utf8Length } from './positions.ts'

/** A record that a reader refuses. `path` is an RFC 6901 pointer to the field inside the record. */
export class CarveLayoutError extends Error {
  path: string
  reason: string

  constructor(path: string, reason: string) {
    super(`${path === '' ? '/' : path}: ${reason}`)
    this.name = 'CarveLayoutError'
    this.path = path
    this.reason = reason
  }
}

type Fields = Record<string, unknown>
type Check = (value: unknown, path: string) => void

const ROOT_FIELDS = ['version', 'encoding', 'source', 'lineEndings', 'bom', 'nodes']
const LINE_ENDINGS = ['none', 'lf', 'crlf', 'cr', 'mixed']
const WRAP_FIELDS = ['line', 'path', 'offset', 'row']

function fail(path: string, reason: string): never {
  throw new CarveLayoutError(path, reason)
}

const checkBoolean: Check = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'is not a boolean')
}

const checkString: Check = (value, path) => {
  if (typeof value !== 'string') fail(path, 'is not a string')
}

function checkCount(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) fail(path, `is not an integer of at least ${minimum}`)
  return value
}

function oneOf(values: readonly string[]): Check {
  return (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) fail(path, `is not one of ${values.join(', ')}`)
  }
}

/** C2-L-010: the empty string, or parts that each start with a slash, in which a tilde stands before 0 or 1. */
const checkPointer: Check = (value, path) => {
  if (typeof value !== 'string') fail(path, 'is not a string')
  if (value !== '' && !value.startsWith('/')) fail(path, 'is not a JSON Pointer')
  for (let at = value.indexOf('~'); at >= 0; at = value.indexOf('~', at + 1)) {
    if (value[at + 1] !== '0' && value[at + 1] !== '1') fail(path, 'is not a JSON Pointer')
  }
}

/** C2-L-020: `line`, `path` and `offset`, an optional `row`, and the list sorted by `line`. */
const checkWraps: Check = (value, path) => {
  if (!Array.isArray(value)) fail(path, 'is not a list')
  let line = 0
  value.forEach((wrap: unknown, index) => {
    const at = `${path}/${index}`
    if (!isRecord(wrap)) fail(at, 'is not an object')
    for (const key of Object.keys(wrap)) if (!WRAP_FIELDS.includes(key)) fail(`${at}/${key}`, 'is not a field of a wrap')
    const own = checkCount(wrap['line'], `${at}/line`, 1)
    if (own < line) fail(`${at}/line`, 'is not sorted by line')
    line = own
    checkPointer(wrap['path'], `${at}/path`)
    checkCount(wrap['offset'], `${at}/offset`)
    if (wrap['row'] !== undefined) checkCount(wrap['row'], `${at}/row`)
  })
}

/** C2-L-009: the facts an entry may have, each with the check of its value. */
const FACTS = new Map<string, Check>([
  ['bare', checkBoolean],
  ['fenced', checkBoolean],
  ['hardBreakOpener', checkBoolean],
  ['wraps', checkWraps],
  ['continuationLines', (value, path) => void checkCount(value, path)],
  ['rawRef', checkString],
  ['sourceFormat', oneOf(['pipe', 'csv', 'tsv'])],
  ['markerRaw', checkString],
  ['markerColumn', (value, path) => void checkCount(value, path)],
  ['contentColumn', (value, path) => void checkCount(value, path)],
  ['continuationStyle', oneOf(['lazy', 'indent', 'marker_line', 'none'])],
  ['blankLinesBefore', (value, path) => void checkCount(value, path)],
  ['blankLinesAfter', (value, path) => void checkCount(value, path)],
  ['openerRaw', checkString],
  ['closerRaw', checkString],
  ['metadataSeparatorRaw', checkString],
  ['attachment', oneOf(['preceding', 'none'])],
])

/** C2-L-027: the two runs come as a pair, and the opener is never empty. */
function checkFence(entry: Fields, path: string): void {
  const opener = entry['openerRaw']
  if ((opener === undefined) !== (entry['closerRaw'] === undefined)) fail(path, 'openerRaw and closerRaw come as a pair')
  if (opener === '') fail(`${path}/openerRaw`, 'is empty')
}

/** Checks one entry and returns its path. `length` is the byte length of the source (C2-L-012). */
function checkEntry(entry: unknown, path: string, length: number): string {
  if (!isRecord(entry)) fail(path, 'is not an object')
  checkPointer(entry['path'], `${path}/path`)
  const start = checkCount(entry['startByte'], `${path}/startByte`)
  const end = checkCount(entry['endByte'], `${path}/endByte`)
  if (start > end) fail(`${path}/startByte`, 'is behind endByte')
  if (end > length) fail(`${path}/endByte`, 'is past the end of the source')
  for (const key of Object.keys(entry)) {
    if (key === 'path' || key === 'startByte' || key === 'endByte') continue
    const check = FACTS.get(key)
    if (check === undefined) fail(`${path}/${key}`, 'is not a field of a node entry')
    check(entry[key], `${path}/${key}`)
  }
  checkFence(entry, path)
  return entry['path'] as string
}

function checkRoot(record: Fields): void {
  for (const key of ROOT_FIELDS) if (record[key] === undefined) fail(`/${key}`, 'is missing')
  for (const key of Object.keys(record)) if (!ROOT_FIELDS.includes(key)) fail(`/${key}`, 'is not a field of the record')
  // C2-L-008.
  if (record['version'] !== LAYOUT_VERSION) fail('/version', `version ${String(record['version'])} is not implemented`)
  if (record['encoding'] !== 'utf-8') fail('/encoding', 'is not utf-8')
  checkString(record['source'], '/source')
  oneOf(LINE_ENDINGS)(record['lineEndings'], '/lineEndings')
  checkBoolean(record['bom'], '/bom')
  if (!Array.isArray(record['nodes'])) fail('/nodes', 'is not a list')
}

// The slots of a node in the order in which the source holds them.
const SLOT_ORDER = ['title', 'children', 'caption']

function compareSegments(a: string, b: string): number {
  const numberA = Number(a)
  const numberB = Number(b)
  if (Number.isInteger(numberA) && Number.isInteger(numberB)) return numberA - numberB
  const slot = SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b)
  if (slot !== 0) return slot
  return a < b ? -1 : a > b ? 1 : 0
}

/** C2-L-011: below 0 when the node at `a` comes before the node at `b` in a walk, a node before the nodes inside it. */
export function compareDocumentOrder(a: string, b: string): number {
  const left = a.split('/')
  const right = b.split('/')
  for (let at = 0; at < left.length && at < right.length; at++) {
    const order = compareSegments(left[at]!, right[at]!)
    if (order !== 0) return order
  }
  return left.length - right.length
}

/** Returns `value` as a record, or throws a `CarveLayoutError` for a record the document refuses. */
export function validateLayout(value: unknown): SourceLayout {
  if (!isRecord(value)) fail('', 'the record is not an object')
  checkRoot(value)
  const length = utf8Length(value['source'] as string)
  let previous: string | null = null
  ;(value['nodes'] as unknown[]).forEach((entry, index) => {
    const path = checkEntry(entry, `/nodes/${index}`, length)
    // C2-L-011: in document order, each path once.
    if (previous !== null && compareDocumentOrder(path, previous) <= 0) {
      fail(`/nodes/${index}/path`, path === previous ? 'is a duplicate path' : 'is not in document order')
    }
    previous = path
  })
  return value as unknown as SourceLayout
}

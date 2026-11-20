// Option checks of the public calls that the engine does not check itself (C2-H-137: an unknown option is refused).
import { CarveOptionError, readOptions } from '../src/options.ts'

export type OptionKind = 'boolean' | 'string' | 'count' | 'extensions' | 'extension-names' | 'layout' | 'losses' | 'labels'

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function checkExtensionNames(name: string, value: unknown): void {
  if (!Array.isArray(value) || !value.every(item => item === 'wikilinks' || item === 'samp')) {
    throw new CarveOptionError(name, 'expected a list of wikilinks or samp')
  }
}

function checkLayout(name: string, value: unknown): void {
  if (!isPlainObject(value) || !Array.isArray(value['nodes'])) throw new CarveOptionError(name, 'not a sidecar with a list of nodes')
  for (const entry of value['nodes'] as unknown[]) {
    if (!validLayoutEntry(entry)) throw new CarveOptionError(name, 'a node entry the writer cannot read')
  }
}

function checkValue(name: string, kind: OptionKind, value: unknown): void {
  switch (kind) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new CarveOptionError(name, 'not a boolean')
      return
    case 'string':
      if (typeof value !== 'string') throw new CarveOptionError(name, 'not a string')
      return
    case 'count':
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CarveOptionError(name, 'not a count')
      return
    case 'extensions':
      readOptions({ extensions: value }, 'parse')
      return
    case 'extension-names':
      checkExtensionNames(name, value)
      return
    case 'losses':
      readOptions({ [name]: value }, 'render')
      return
    case 'labels':
      readOptions({ labels: value }, 'render')
      return
    case 'layout':
      checkLayout(name, value)
  }
}

const ENTRY_FIELDS: Readonly<Record<string, string>> = {
  path: 'string', bare: 'boolean', fenced: 'boolean', hardBreakOpener: 'boolean', continuationLines: 'number', rawRef: 'string',
  sourceFormat: 'string', headerRows: 'number',
}

function validWrap(wrap: unknown): boolean {
  return isPlainObject(wrap) && typeof wrap['line'] === 'number' && typeof wrap['path'] === 'string' &&
    typeof wrap['offset'] === 'number' && (wrap['row'] === undefined || typeof wrap['row'] === 'number')
}

/** The fields of a layout node entry that the writer reads (WriterFacts), each of its type. */
function validLayoutEntry(entry: unknown): boolean {
  if (!isPlainObject(entry) || typeof entry['path'] !== 'string') return false
  for (const [field, type] of Object.entries(ENTRY_FIELDS)) {
    if (entry[field] !== undefined && typeof entry[field] !== type) return false
  }
  const wraps = entry['wraps']
  if (wraps !== undefined && (!Array.isArray(wraps) || !wraps.every(validWrap))) return false
  const spelling = entry['optionSpelling']
  return spelling === undefined || (isPlainObject(spelling) && Object.values(spelling).every((item) => typeof item === 'string'))
}

/** Refuses an options value that is not an object, an unknown name, or a value of the wrong kind. */
export function checkOptions(options: unknown, kinds: Readonly<Record<string, OptionKind>>): void {
  if (options === undefined) return
  if (!isPlainObject(options)) throw new CarveOptionError('options', 'not an object')
  for (const [name, value] of Object.entries(options)) {
    const kind = kinds[name]
    if (kind === undefined) throw new CarveOptionError(name, 'unknown option')
    if (value !== undefined) checkValue(name, kind, value)
  }
}

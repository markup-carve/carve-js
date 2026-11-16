// The `includes` option (C2-N-003, C2-N-007): the resolver a host gives, the id of the top-level document, and the
// two limits, which a host may lower and may not raise (C2-N-064, C2-N-065).
import { type IncludeOptions } from './ast.ts'
import { INCLUDE_BYTES, INCLUDE_DEPTH } from './include-tables.ts'

/** C2-N-007: the error causes a resolver returns. */
export type IncludeError = 'not_found' | 'outside_root' | 'unreadable' | 'non_text'

/** C2-N-007: what a resolver receives for one directive. `from` is absent for a top-level document that has no id. */
export interface IncludeRequest {
  path: string
  section?: string
  options: IncludeOptions
  from?: string
}

/** C2-N-007: the whole text of the target and its id, or one error cause. Bytes are decoded as UTF-8 (C2-N-011). */
export type IncludeAnswer = { text: string | Uint8Array, id: string } | { error: IncludeError }

export type IncludeResolver = (request: IncludeRequest) => IncludeAnswer

/** The value of the `includes` option: a resolver alone, or a resolver with the document id and lowered limits. */
export interface IncludeConfig {
  resolver: IncludeResolver
  /** C2-N-066: the id of the top-level document, which a cycle can return to. */
  file?: string
  depth?: number
  bytes?: number
}

export interface IncludeSettings {
  resolver: IncludeResolver
  file: string | undefined
  depth: number
  bytes: number
}

const FIELDS = ['resolver', 'file', 'depth', 'bytes']

function limit(value: unknown, name: string, ceiling: number, refuse: (reason: string) => Error): number {
  if (value === undefined) return ceiling
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw refuse(`${name} is not a count`)
  if (value > ceiling) throw refuse(`${name} may be lowered and not raised above ${ceiling}`)
  return value
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** C2-N-003: reads the option; `refuse` makes the error of a value it cannot take. */
export function includeSettings(value: unknown, refuse: (reason: string) => Error): IncludeSettings | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'function') {
    return { resolver: value as IncludeResolver, file: undefined, depth: INCLUDE_DEPTH, bytes: INCLUDE_BYTES }
  }
  if (!isRecord(value)) throw refuse('a root is read by the command line; a library call gives a resolver')
  for (const name of Object.keys(value)) if (!FIELDS.includes(name)) throw refuse(`unknown field ${name}`)
  const resolver = value['resolver']
  if (typeof resolver !== 'function') throw refuse('resolver is not a function')
  const file = value['file']
  if (file !== undefined && typeof file !== 'string') throw refuse('file is not a string')
  return {
    resolver: resolver as IncludeResolver,
    file,
    depth: limit(value['depth'], 'depth', INCLUDE_DEPTH, refuse),
    bytes: limit(value['bytes'], 'bytes', INCLUDE_BYTES, refuse),
  }
}

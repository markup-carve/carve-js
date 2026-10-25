import type { Document } from '../ast.js'
import { fromAstJson, type AstJsonDocument } from './json.js'
import { runtimeWireToContract2 } from './contract2-wire.js'

export interface AstJsonMigrationLoss {
  path: string
  reason: string
}

export class AstJsonMigrationInputError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'AstJsonMigrationInputError'
  }
}

/** Convert a contract 1.2 wire document to contract 2.0. */
export function migrateAstJson(input: unknown, options: { source?: string } = {}): { tree: AstJsonDocument; losses: AstJsonMigrationLoss[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input as { type?: unknown }).type !== 'document') {
    throw new AstJsonMigrationInputError('expected a contract 1.2 or 2.0 document')
  }
  const root = input as Record<string, unknown>
  if (root.astVersion === '2.0') {
    const extensions = Array.isArray(root.extensions) ? root.extensions.flatMap(value => value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string' ? [(value as { name: string }).name] : []) : []
    try { fromAstJson(input, undefined, extensions) } catch (error) { throw new AstJsonMigrationInputError((error as Error).message) }
    return { tree: input as AstJsonDocument, losses: [] }
  }
  if ((root.astVersion !== undefined && root.astVersion !== '1.2') || !Array.isArray(root.children)) {
    throw new AstJsonMigrationInputError('expected a contract 1.2 or 2.0 document')
  }
  const losses: AstJsonMigrationLoss[] = []
  const offsets: number[] = [0]
  if (options.source !== undefined) {
    const encoder = new TextEncoder()
    for (const point of options.source) offsets.push(offsets[offsets.length - 1]! + encoder.encode(point).length)
  }
  const pointer = (path: string, key: string | number) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`
  const transform = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => transform(item, pointer(path, index)))
    if (!value || typeof value !== 'object') return value
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const at = pointer(path, key)
      if ((key === 'startOffset' || key === 'endOffset' || key === 'offset') && typeof child === 'number') {
        if (options.source === undefined) { output[key] = child; continue }
        if (offsets[child] === undefined) { losses.push({ path: at, reason: 'offset falls outside the supplied source' }); continue }
        output[key] = offsets[child]
      } else output[key] = transform(child, at)
    }
    return output
  }
  const prepared = transform(input, '') as Record<string, unknown>
  // The encoder also handles table partitions, captions and reference namespaces.
  const tree = runtimeWireToContract2(prepared, prepared as unknown as Document) as unknown as AstJsonDocument
  if (options.source === undefined) {
    const strip = (value: unknown, path: string): void => {
      if (Array.isArray(value)) { value.forEach((item, index) => strip(item, pointer(path, index))); return }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      for (const [key, child] of Object.entries(record)) {
        const at = pointer(path, key)
        if (key === 'pos' || key === 'segments' || key === 'cellWraps') {
          losses.push({ path: at, reason: 'source is required to convert codepoint offsets to UTF-8 bytes' })
          delete record[key]
        } else strip(child, at)
      }
    }
    strip(tree, '')
  }
  try { fromAstJson(tree) } catch (error) { throw new AstJsonMigrationInputError((error as Error).message) }
  return { tree, losses }
}

/** A small, serializable JSON-Patch subset for PART 12 exchange trees. */

import type { AstJsonDocument } from './ast-json.js'

export type AstPatchOperation =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }

export class AstPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AstPatchError'
  }
}

function pointer(path: string, key: string): string {
  return `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
}

function decode(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) throw new AstPatchError(`invalid JSON Pointer ${JSON.stringify(path)}`)
  return path
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (typeof value !== 'object' || value === null) return value
  const out = Object.create(null) as Record<string, unknown>
  for (const [key, child] of Object.entries(value)) {
    if (key === 'pos' || key === 'srcByteLength') continue
    out[key] = clean(child)
  }
  return out
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b))
}

function build(before: unknown, after: unknown, path: string, out: AstPatchOperation[]): void {
  if (equal(before, after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      // One sequence replacement is stable under serialization and avoids the
      // index-shift hazards of a remove/add script. The three-way merge owns
      // move reconciliation; a patch owns faithful replay.
      out.push({ op: 'replace', path, value: clean(after) })
    } else {
      for (let index = 0; index < before.length; index++) {
        build(before[index], after[index], pointer(path, String(index)), out)
      }
    }
    return
  }
  if (
    typeof before === 'object' &&
    before !== null &&
    !Array.isArray(before) &&
    typeof after === 'object' &&
    after !== null &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>
    const b = after as Record<string, unknown>
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    keys.delete('pos')
    keys.delete('srcByteLength')
    for (const key of keys) {
      const childPath = pointer(path, key)
      if (!Object.hasOwn(b, key)) out.push({ op: 'remove', path: childPath })
      else if (!Object.hasOwn(a, key)) out.push({ op: 'add', path: childPath, value: clean(b[key]) })
      else build(a[key], b[key], childPath, out)
    }
    return
  }
  out.push({ op: 'replace', path, value: clean(after) })
}

/** Produce position-independent operations that replay one semantic AST into another. */
export function createAstPatch(before: AstJsonDocument, after: AstJsonDocument): AstPatchOperation[] {
  const out: AstPatchOperation[] = []
  build(before, after, '', out)
  return out
}

function parentAt(root: unknown, parts: string[]): { parent: unknown; key: string } {
  if (parts.length === 0) throw new AstPatchError('the document root cannot be removed')
  let parent = root
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(parent)) {
      const index = Number(part)
      if (!Number.isSafeInteger(index) || index < 0 || index >= parent.length) {
        throw new AstPatchError(`array index ${JSON.stringify(part)} is out of range`)
      }
      parent = parent[index]
    } else if (typeof parent === 'object' && parent !== null && Object.hasOwn(parent, part)) {
      parent = (parent as Record<string, unknown>)[part]
    } else throw new AstPatchError(`path component ${JSON.stringify(part)} does not exist`)
  }
  return { parent, key: parts.at(-1)! }
}

/** Apply a serialized patch without mutating the input tree. */
export function applyAstPatch(
  ast: AstJsonDocument,
  operations: readonly AstPatchOperation[],
): AstJsonDocument {
  let root = clean(ast)
  for (const operation of operations) {
    const parts = decode(operation.path)
    if (parts.length === 0) {
      if (operation.op === 'remove') throw new AstPatchError('the document root cannot be removed')
      root = clean(operation.value)
      continue
    }
    const { parent, key } = parentAt(root, parts)
    if (Array.isArray(parent)) {
      const index = Number(key)
      const max = operation.op === 'add' ? parent.length : parent.length - 1
      if (!Number.isSafeInteger(index) || index < 0 || index > max) {
        throw new AstPatchError(`array index ${JSON.stringify(key)} is out of range`)
      }
      if (operation.op === 'add') parent.splice(index, 0, clean(operation.value))
      else if (operation.op === 'remove') parent.splice(index, 1)
      else parent[index] = clean(operation.value)
    } else if (typeof parent === 'object' && parent !== null) {
      const record = parent as Record<string, unknown>
      if (operation.op !== 'add' && !Object.hasOwn(record, key)) {
        throw new AstPatchError(`path component ${JSON.stringify(key)} does not exist`)
      }
      if (operation.op === 'remove') delete record[key]
      else record[key] = clean(operation.value)
    } else throw new AstPatchError(`path parent for ${JSON.stringify(operation.path)} is not a container`)
  }
  if (
    typeof root !== 'object' ||
    root === null ||
    (root as { type?: unknown }).type !== 'document' ||
    !Array.isArray((root as { children?: unknown }).children)
  ) {
    throw new AstPatchError('patch result is not a PART 12 document root')
  }
  const result = root as AstJsonDocument
  result.srcByteLength = 0
  return result
}

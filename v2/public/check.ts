// Option checks of the public calls that the engine does not check itself (C2-H-137: an unknown option is refused).
import { CarveOptionError, readOptions } from '../src/options.ts'

export type OptionKind = 'boolean' | 'string' | 'extensions' | 'layout'

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function checkValue(name: string, kind: OptionKind, value: unknown): void {
  switch (kind) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new CarveOptionError(name, 'not a boolean')
      return
    case 'string':
      if (typeof value !== 'string') throw new CarveOptionError(name, 'not a string')
      return
    case 'extensions':
      readOptions({ extensions: value }, 'parse')
      return
    case 'layout':
      if (!isPlainObject(value) || !Array.isArray(value['nodes'])) throw new CarveOptionError(name, 'not a sidecar with a list of nodes')
  }
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

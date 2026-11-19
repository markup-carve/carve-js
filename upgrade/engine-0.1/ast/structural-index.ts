import { NODE_POSITION_KIND } from './wire-fields.js'

export type AstPath = Array<string | number>

export function astPointer(path: AstPath): string {
  return path.map(part => '/' + String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('')
}

export class AstStructuralIndex {
  private objects = new WeakMap<object, [number | undefined, number | undefined]>()
  private readonly keys = new Map<string, number>()

  key(value: unknown, nodePosition = true): number {
    if (typeof value !== 'object' || value === null) return this.intern(`scalar:${JSON.stringify(value)}`)
    const policy = nodePosition ? 1 : 0
    const cached = this.objects.get(value)
    if (cached?.[policy] !== undefined) return cached[policy]
    let key: string
    if (Array.isArray(value)) {
      key = JSON.stringify(['array', Array.from(value, child => this.key(
        child === undefined || typeof child === 'function' || typeof child === 'symbol' ? null : child, nodePosition,
      ))])
    } else {
      const record = value as Record<string, unknown>
      const fields: Array<[string, number]> = []
      for (const name of Object.keys(record).sort()) {
        if (nodePosition && (name === 'pos' || name === 'srcByteLength')) continue
        const child = record[name]
        if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue
        const childPosition = typeof record.type === 'string' && Object.hasOwn(NODE_POSITION_KIND, `${record.type}.${name}`)
        fields.push([name, this.key(child, childPosition)])
      }
      key = JSON.stringify(['object', fields])
    }
    const id = this.intern(key)
    const ids = cached ?? [undefined, undefined]
    ids[policy] = id
    this.objects.set(value, ids)
    return id
  }

  forgetObjects(): void {
    this.objects = new WeakMap()
  }

  private intern(key: string): number {
    const found = this.keys.get(key)
    if (found !== undefined) return found
    const id = this.keys.size
    this.keys.set(key, id)
    return id
  }
}

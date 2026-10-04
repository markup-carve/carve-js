export function lazyLineArray(length: number, at: (index: number) => string, materialized: (lines: string[]) => void): readonly string[] {
  const target: string[] = []
  let ready = false
  const indexOf = (key: PropertyKey): number | undefined => {
    if (typeof key !== 'string') return undefined
    const index = Number(key)
    return Number.isInteger(index) && index >= 0 && index < 0xffffffff && String(index) === key ? index : undefined
  }
  const prepare = (): void => {
    if (ready) return
    for (let i = 0; i < length; i++) target.push(at(i))
    ready = true
    materialized(target)
  }
  return new Proxy(target, {
    get(array, key, receiver): unknown {
      if (!ready) {
        if (key === 'length') return length
        const index = indexOf(key)
        if (index !== undefined && index < length) return at(index)
      }
      const value: unknown = Reflect.get(array, key, receiver)
      return value
    },
    has(array, key): boolean {
      const index = indexOf(key)
      return !ready && index !== undefined && index < length ? true : Reflect.has(array, key)
    },
    ownKeys(array): (string | symbol)[] {
      return ready ? Reflect.ownKeys(array) : [...Array.from({ length }, (_value, i) => String(i)), 'length']
    },
    getOwnPropertyDescriptor(array, key): PropertyDescriptor | undefined {
      if (!ready) {
        if (key === 'length') return { value: length, writable: true, enumerable: false, configurable: false }
        const index = indexOf(key)
        if (index !== undefined && index < length) return { value: at(index), writable: true, enumerable: true, configurable: true }
      }
      return Reflect.getOwnPropertyDescriptor(array, key)
    },
    set(array, key, value: unknown): boolean {
      prepare()
      return Reflect.set(array, key, value)
    },
    defineProperty(array, key, descriptor): boolean {
      prepare()
      return Reflect.defineProperty(array, key, descriptor)
    },
    deleteProperty(array, key): boolean {
      prepare()
      return Reflect.deleteProperty(array, key)
    },
    preventExtensions(array): boolean {
      prepare()
      return Reflect.preventExtensions(array)
    },
    setPrototypeOf(array, prototype: object | null): boolean {
      prepare()
      return Reflect.setPrototypeOf(array, prototype)
    },
  })
}

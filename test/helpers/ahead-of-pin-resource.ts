import { existsSync } from 'node:fs'

export function specResource(name: string): URL {
  const vendored = new URL(`../fixtures/ahead-of-pin/${name}`, import.meta.url)
  return existsSync(vendored) ? vendored : new URL(`../../spec/resources/${name}`, import.meta.url)
}

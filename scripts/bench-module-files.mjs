import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export function namedModuleFiles(root, names) {
  const wanted = new Set(names)
  const found = new Map()
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (wanted.has(entry.name)) {
        if (found.has(entry.name)) throw new Error(`Duplicate module: ${entry.name}`)
        found.set(entry.name, path)
      }
    }
  }
  visit(root)
  return names.map(name => [name, found.get(name)])
}

export function namedModuleHash(root, names) {
  const hash = createHash('sha256')
  for (const [name, path] of namedModuleFiles(root, names)) {
    hash.update(name).update('\0')
    hash.update(path === undefined ? '<missing>' : readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

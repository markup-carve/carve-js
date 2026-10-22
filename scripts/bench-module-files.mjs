import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'

export function namedModuleFiles(root, names) {
  const wanted = new Set(names)
  const found = new Map()
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (wanted.has(entry.name)) {
        const matches = found.get(entry.name) ?? []
        matches.push(path)
        found.set(entry.name, matches)
      }
    }
  }
  visit(root)
  return names.map(name => {
    const matches = found.get(name) ?? []
    if (matches.length < 2) return [name, matches[0]]
    const sourceRoot = resolve(dirname(root), 'src')
    const matchingSource = matches.filter(path => existsSync(join(sourceRoot, relative(root, path).replace(/\.js$/, '.ts'))))
    if (matchingSource.length !== 1) throw new Error(`Ambiguous module: ${name}`)
    return [name, matchingSource[0]]
  })
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

// The resolver of the command line (C2-N-012 to C2-N-014): it reads files below one containment root. An id is the
// canonical path of the target relative to the root, so `a/b.crv` and `a/./b.crv` are one id (C2-N-009).
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { type IncludeAnswer, type IncludeRequest, type IncludeResolver } from '../src/include-settings.ts'
import { INCLUDE_BYTES } from '../src/include-tables.ts'

/** C2-N-012: letters and `:` before any `/` is a URI scheme, which names nothing this resolver reads. */
function hasScheme(path: string): boolean {
  const colon = path.indexOf(':')
  if (colon < 1) return false
  const slash = path.indexOf('/')
  if (slash >= 0 && slash < colon) return false
  for (let at = 0; at < colon; at++) {
    const code = path.charCodeAt(at) | 0x20
    if (code < 0x61 || code > 0x7a) return false
  }
  return true
}

/** C2-N-013: the canonical form of `target` whether or not it exists: the longest prefix that exists, then the rest. */
function canonical(target: string): string {
  const rest: string[] = []
  let prefix = target
  for (;;) {
    try {
      return join(realpathSync(prefix), ...rest)
    } catch {
      const parent = dirname(prefix)
      if (parent === prefix) return join(prefix, ...rest)
      rest.unshift(basename(prefix))
      prefix = parent
    }
  }
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..')
}

/** The id of a canonical path inside the root. */
export function idOf(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}

/**
 * C2-N-012 to C2-N-014: reads below `root`, an absolute path whose canonical form the caller has taken. The test of
 * containment comes before any test of existence, so a cause never tells whether a file outside the root exists.
 */
export function fileResolver(root: string): IncludeResolver {
  return (request: IncludeRequest): IncludeAnswer => {
    if (hasScheme(request.path)) return { error: 'outside_root' }
    const base = request.from === undefined ? root : dirname(join(root, request.from))
    const target = canonical(resolve(base, request.path))
    if (!inside(root, target)) return { error: 'outside_root' }
    try {
      const info = statSync(target)
      // A FIFO or a device would block the read, and a file past the size cap is not read into memory (C2-N-065).
      if (!info.isFile() || info.size > INCLUDE_BYTES) return { error: 'unreadable' }
      return { text: readFileSync(target), id: idOf(root, target) }
    } catch (error) {
      const code = errorCode(error)
      return { error: code === 'ENOENT' || code === 'ENOTDIR' ? 'not_found' : 'unreadable' }
    }
  }
}

/**
 * C2-N-004, C2-N-014: the includes of one entry of the command line: the root is the directory of the entry file, or
 * the root named, as a canonical path. With the entry on standard input and no root named, nothing is expanded.
 */
export function cliIncludes(entry: string, root: string | undefined): { resolver: IncludeResolver, file?: string } | null {
  if (root === undefined && entry === '-') return null
  // C2-N-014: a root is absolute; the command line reads a relative argument from the working directory.
  const real = realpathSync(resolve(root ?? dirname(resolve(entry))))
  const resolver = fileResolver(real)
  // The id of the entry is its path from the root, which may lead out of it: its includes resolve from its directory.
  return entry === '-' ? { resolver } : { resolver, file: idOf(real, canonical(resolve(entry))) }
}

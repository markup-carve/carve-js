// The resolver of the command line (C2-N-012 to C2-N-014): it reads files below one containment root. An id is the
// canonical path of the target relative to the root, so `a/b.crv` and `a/./b.crv` are one id (C2-N-009).
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
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
 * The bytes of the open file, at most a little past the size cap: a file past it is refused by the expansion with
 * `include-budget` (C2-N-065) and is never read into memory whole.
 */
function readCapped(fd: number, cap: number): Uint8Array | null {
  if (cap < INCLUDE_BYTES && fstatSync(fd).size > cap) return null
  const limit = INCLUDE_BYTES + 4
  const buffer = new Uint8Array(limit)
  let length = 0
  for (let read = 1; read > 0 && length < limit; length += read) read = readSync(fd, buffer, length, limit - length, null)
  if (length <= INCLUDE_BYTES) return buffer.subarray(0, length)
  // Trap: a cut inside a character makes the prefix read as non_text instead of past the cap.
  let lead = length - 1
  while (lead > INCLUDE_BYTES && ((buffer[lead] ?? 0) & 0xc0) === 0x80) lead--
  return buffer.subarray(0, lead + sequenceLength(buffer[lead] ?? 0) <= length ? length : lead)
}

/** The length of the UTF-8 sequence that `lead` starts. */
function sequenceLength(lead: number): number {
  if (lead >= 0xf0) return 4
  if (lead >= 0xe0) return 3
  return lead >= 0xc0 ? 2 : 1
}

/**
 * C2-N-013: reads the file that the containment test passed. After the open, the path is canonicalized and tested
 * again, and the open file must be the file found there, so a link swapped between test and open is never read.
 */
function readTested(root: string, wanted: string, target: string, cap: number): IncludeAnswer {
  let fd: number
  try {
    // A FIFO opened without O_NONBLOCK would block until a writer comes.
    fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    const code = errorCode(error)
    return { error: code === 'ENOENT' || code === 'ENOTDIR' ? 'not_found' : 'unreadable' }
  }
  try {
    const opened = fstatSync(fd)
    const again = canonical(wanted)
    if (!inside(root, again)) return { error: 'outside_root' }
    const there = statSync(again)
    if (there.dev !== opened.dev || there.ino !== opened.ino || !opened.isFile()) return { error: 'unreadable' }
    const text = readCapped(fd, cap)
    return text === null ? { error: 'unreadable' } : { text, id: idOf(root, again) }
  } catch {
    return { error: 'unreadable' }
  } finally {
    closeSync(fd)
  }
}

/** A step a test runs between the containment test and the read, to change the file system there. */
export interface ResolverHooks {
  afterTest?: () => void
}

/** The options of `fileSystemResolver`. */
export interface FileResolverOptions {
  /** A file larger than this many bytes is `unreadable`. It may lower the size cap of C2-N-065, not raise it. */
  maxFileBytes?: number
  /** Off: an absolute path is `outside_root` even inside the root. On by default, as C2-N-012 allows it. */
  allowAbsolute?: boolean
}

/**
 * C2-N-012 to C2-N-014: reads below `root`, an absolute path whose canonical form the caller has taken. The test of
 * containment comes before any test of existence, so a cause never tells whether a file outside the root exists.
 */
export function fileResolver(root: string, hooks: ResolverHooks = {}, options: FileResolverOptions = {}): IncludeResolver {
  const cap = Math.min(options.maxFileBytes ?? INCLUDE_BYTES, INCLUDE_BYTES)
  return (request: IncludeRequest): IncludeAnswer => {
    if (hasScheme(request.path)) return { error: 'outside_root' }
    if (options.allowAbsolute === false && isAbsolute(request.path)) return { error: 'outside_root' }
    const base = request.from === undefined ? root : dirname(join(root, request.from))
    const wanted = resolve(base, request.path)
    const target = canonical(wanted)
    if (!inside(root, target)) return { error: 'outside_root' }
    hooks.afterTest?.()
    return readTested(root, wanted, target, cap)
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

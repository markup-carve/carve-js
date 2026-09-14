/**
 * The filesystem include resolver.
 *
 * Deliberately NOT part of `src/index.ts`. It is the one piece of the include
 * feature that needs `node:fs`, and the package's browser bundle is built from
 * that entry unmodified - pulling a Node built-in into it fails the bundle
 * outright. Node hosts reach this through the `./node` subpath; a browser or
 * WASM host supplies its own resolver, which is the arrangement PART 9 section
 * 19 already describes: the parser performs no file I/O and the host owns
 * containment.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { IncludeResolver } from './includes.js'

export interface FileSystemResolverOptions {
  /** Allow absolute include paths after root containment checks. Default false. */
  allowAbsolute?: boolean
  /**
   * Largest target this resolver will read, in bytes. Default 4 MiB; pass
   * `Infinity` for no cap.
   *
   * The expander's byte budget cannot stand in for this: it charges a target
   * only once the source is in hand, so without a cap here one oversized file
   * is read into memory in full before expansion is refused.
   */
  maxFileBytes?: number
}

/** Default per-target read cap for {@link fileSystemResolver}: 4 MiB. */
export const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024

/** Filesystem resolver with canonical root-containment checks for trusted hosts. */
export function fileSystemResolver(
  root: string,
  opts: FileSystemResolverOptions = {},
): IncludeResolver {
  const rootReal = realpathSync(root)
  /**
   * Canonicalize-then-contain: the candidate is resolved to its real path
   * (symlinks followed) and only then compared against the real root.
   *
   * Deliberately NOT a lexical ban on "..", which is both too strict and too
   * weak. Too strict: "../shared/glossary.crv" from chapters/ch1.crv is a
   * normal book layout whose canonical target is inside the root, and must
   * resolve. Too weak: a symlink inside the root pointing out of it, or an
   * absolute path, escapes without containing ".." at all. Canonical
   * containment subsumes both cases.
   */
  const contains = (candidate: string): boolean => {
    const rel = path.relative(rootReal, candidate)
    if (rel === '') return true
    if (!rel || path.isAbsolute(rel)) return false
    // Segment-wise, so a directory legitimately named "..foo" is not read as
    // an escape the way a `startsWith('..')` prefix test would.
    return rel.split(path.sep)[0] !== '..'
  }
  return (includePath, ctx) => {
    if (!opts.allowAbsolute && path.isAbsolute(includePath)) return null
    // The stack carries the canonical (real) path of each ancestor, so a
    // nested relative include resolves against its actual parent directory,
    // not the root.
    const parent = ctx.stack[ctx.stack.length - 1]
    const base = parent ? path.dirname(path.resolve(rootReal, parent)) : rootReal
    const resolved = path.isAbsolute(includePath) ? includePath : path.resolve(base, includePath)
    let real: string
    try {
      real = realpathSync(resolved)
    } catch {
      return null
    }
    if (!contains(real)) return null
    const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    if (Number.isFinite(maxFileBytes)) {
      try {
        if (statSync(real).size > maxFileBytes) return null
      } catch {
        return null
      }
    }
    return { source: readFileSync(real, 'utf8'), id: real }
  }
}

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

/**
 * Filesystem resolver with canonical root-containment checks for trusted hosts.
 *
 * Throws on a root that cannot be canonicalized, and on one that is not
 * absolute: a host with no usable root leaves inclusion disabled.
 */
export function fileSystemResolver(
  root: string,
  opts: FileSystemResolverOptions = {},
): IncludeResolver {
  // PART 9 section 19: a configured root MUST be absolute, and MUST NOT
  // default to the process working directory. `realpathSync` resolves a
  // relative spec against exactly that, so "." would root containment at the
  // working directory and ".." at its parent - the forbidden value, by a route
  // the default rule does not cover.
  //
  // Absoluteness SUBSUMES the blank and whitespace-only refusals this replaces
  // (carve-js#1690): neither is absolute. That is the point rather than a
  // simplification - "   " is a legal POSIX directory name, refused for being
  // RELATIVE and not for being empty, and such a directory stays reachable by
  // its absolute path. A front end may still expand its own relative argument
  // before calling this; the rule constrains the root, not its derivation.
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error(
      'The include containment root must be an absolute path: a relative value is not a root.',
    )
  }
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
  /**
   * The candidate's canonical spelling whether or not it is there: the longest
   * prefix that exists is canonicalized, which resolves every symlink actually
   * on disk, and the remaining segments are re-appended. A symlink can only
   * live on the existing prefix, so the tail cannot hide one.
   */
  const canonicalCandidate = (candidate: string): string => {
    const remainder: string[] = []
    let prefix = path.resolve(candidate)
    for (;;) {
      try {
        return path.join(realpathSync(prefix), ...remainder)
      } catch {
        const parent = path.dirname(prefix)
        if (parent === prefix) return path.join(prefix, ...remainder)
        remainder.unshift(path.basename(prefix))
        prefix = parent
      }
    }
  }
  return (includePath, ctx) => {
    if (!opts.allowAbsolute && path.isAbsolute(includePath)) {
      return { source: null, id: includePath, denial: 'denied' }
    }
    // The stack carries the canonical (real) path of each ancestor, so a
    // nested relative include resolves against its actual parent directory,
    // not the root.
    const parent = ctx.stack[ctx.stack.length - 1]
    const base = parent ? path.dirname(path.resolve(rootReal, parent)) : rootReal
    const resolved = path.isAbsolute(includePath) ? includePath : path.resolve(base, includePath)
    let real: string
    try {
      real = realpathSync(resolved)
    } catch (error) {
      // I11: nothing is there, so the target is named by where it WOULD be,
      // which is the path a host watches. One that would land outside the root
      // is refused as any other escape is, and keeps the directive's spelling.
      // So does a request that names no filesystem place at all: a URI scheme
      // has no "where it would appear" for this resolver to point at.
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(includePath)) {
        return { source: null, id: includePath, denial: 'denied' }
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return { source: null, id: resolved, denial: 'denied' }
      }
      const wouldBe = canonicalCandidate(resolved)
      return contains(wouldBe)
        ? { source: null, id: wouldBe, denial: 'not-found' }
        : { source: null, id: includePath, denial: 'outside-root' }
    }
    if (!contains(real)) return { source: null, id: includePath, denial: 'outside-root' }
    const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    if (Number.isFinite(maxFileBytes)) {
      try {
        if (statSync(real).size > maxFileBytes) {
          return { source: null, id: real, denial: 'denied' }
        }
      } catch {
        return { source: null, id: real, denial: 'denied' }
      }
    }
    try {
      return { source: readFileSync(real, 'utf8'), id: real }
    } catch {
      return { source: null, id: real, denial: 'denied' }
    }
  }
}

import { chmodSync, closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, lstatSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { migrateMarkdown } from './index.js'

interface Entry { path: string; kind: 'markdown' | 'asset' | 'skipped'; dev: number; ino: number }

function collect(root: string, dir = root): Entry[] {
  const entries: Entry[] = []
  for (const name of readdirSync(dir).sort()) {
    const absolute = join(dir, name)
    const status = lstatSync(absolute)
    if (status.isDirectory()) entries.push(...collect(root, absolute))
    else entries.push({
      path: relative(root, absolute).split(sep).join('/'),
      kind: status.isFile() ? (/\.(md|markdown)$/i.test(name) ? 'markdown' : 'asset') : 'skipped',
      dev: status.dev,
      ino: status.ino,
    })
  }
  return entries
}

function futurePath(path: string): string {
  let ancestor = path
  const missing: string[] = []
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error(`cannot resolve output path: ${path}`)
    missing.unshift(basename(ancestor))
    ancestor = parent
  }
  return join(realpathSync(ancestor), ...missing)
}

/**
 * Read a collected file only if it is still the regular file `collect` saw. A
 * symlink, special file or replaced entry swapped in since then is refused.
 */
export function readCollectedFile(path: string, expected: { dev: number; ino: number }, label = path): { bytes: Buffer; mode: number } {
  let fd: number
  try { fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new Error(`changed during migration: ${label}`)
    throw new Error(`cannot read ${label}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
  }
  try {
    const status = fstatSync(fd)
    if (!status.isFile() || (expected.ino !== 0 && (status.ino !== expected.ino || status.dev !== expected.dev))) {
      throw new Error(`changed during migration: ${label}`)
    }
    try { return { bytes: readFileSync(fd), mode: status.mode & 0o777 } }
    catch (error) { throw new Error(`cannot read ${label}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`) }
  } finally {
    closeSync(fd)
  }
}

/**
 * Move the finished tree into place. On POSIX, rename() replaces an empty
 * directory, so claim the path with an exclusive mkdir first.
 */
export function placeOutput(temporary: string, outputRoot: string): void {
  if (process.platform === 'win32') {
    if (pathExists(outputRoot)) throw new Error(`output appeared during conversion: ${outputRoot}`)
    renameSync(temporary, outputRoot)
    return
  }
  try { mkdirSync(outputRoot) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`output appeared during conversion: ${outputRoot}`)
    throw error
  }
  try { renameSync(temporary, outputRoot) }
  catch (error) {
    try { rmdirSync(outputRoot) } catch { /* not ours or not empty: leave it */ }
    throw new Error(`output appeared during conversion: ${outputRoot}`, { cause: error })
  }
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function migrateMarkdownDirectory(source: string, target: string): { files: number; assets: number; review: number; skipped: number; report: string } {
  const sourcePath = resolve(source)
  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) throw new Error(`source is not a directory: ${sourcePath}`)
  const sourceRoot = realpathSync(sourcePath)
  const outputRoot = futurePath(resolve(target))
  if (pathExists(outputRoot)) throw new Error(`output already exists: ${outputRoot}`)
  const nested = relative(sourceRoot, outputRoot)
  if (nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))) {
    throw new Error('output must be outside the source directory')
  }
  const entries = collect(sourceRoot)
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  if (!entries.some((entry) => entry.kind === 'markdown')) throw new Error('source contains no Markdown files')
  mkdirSync(dirname(outputRoot), { recursive: true })
  const shell = mkdtempSync(join(dirname(outputRoot), `.${basename(outputRoot)}-`))
  const temporary = join(shell, 'out')
  mkdirSync(temporary)
  const files: Array<{ source: string; output: string; diagnostics: ReturnType<typeof migrateMarkdown>['report']['diagnostics'] }> = []
  const assets: string[] = []
  const skipped: string[] = []
  const destinations = new Set(['migration-report.json'])
  try {
    for (const entry of entries) {
      if (entry.kind === 'skipped') { skipped.push(entry.path); continue }
      const destination = entry.kind === 'markdown' ? entry.path.replace(/\.(md|markdown)$/i, '.crv') : entry.path
      const key = destination.toLowerCase()
      if (destinations.has(key)) throw new Error(`two inputs map to the same output: ${destination}`)
      destinations.add(key)
      const out = join(temporary, destination)
      mkdirSync(dirname(out), { recursive: true })
      const read = readCollectedFile(join(sourceRoot, entry.path), entry, entry.path)
      if (entry.kind === 'asset') {
        writeFileSync(out, read.bytes, { flag: 'wx' })
        if (process.platform !== 'win32') chmodSync(out, read.mode)
        assets.push(entry.path)
      } else {
        let sourceText: string
        try { sourceText = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes) }
        catch { throw new Error(`invalid UTF-8 in ${entry.path}`) }
        const result = migrateMarkdown(sourceText)
        writeFileSync(out, result.value, { flag: 'wx' })
        files.push({ source: entry.path, output: destination, diagnostics: result.report.diagnostics })
      }
    }
    const review = files.filter((file) => file.diagnostics.some((diagnostic) => diagnostic.fidelity === 'degraded' || diagnostic.fidelity === 'dropped')).map((file) => file.source)
    writeFileSync(join(temporary, 'migration-report.json'), JSON.stringify({ schemaVersion: 1, sourceFormat: 'markdown', files, assets, skipped, review }, null, 2) + '\n')
    placeOutput(temporary, outputRoot)
    rmSync(shell, { recursive: true, force: true })
    return { files: files.length, assets: assets.length, review: review.length, skipped: skipped.length, report: join(outputRoot, 'migration-report.json') }
  } catch (error) {
    rmSync(shell, { recursive: true, force: true })
    throw error
  }
}

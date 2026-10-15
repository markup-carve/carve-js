import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, lstatSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { migrateMarkdown } from './index.js'

interface Entry { path: string; kind: 'markdown' | 'asset' | 'skipped' }

function collect(root: string, dir = root): Entry[] {
  const entries: Entry[] = []
  for (const name of readdirSync(dir).sort()) {
    const absolute = join(dir, name)
    const status = lstatSync(absolute)
    if (status.isDirectory()) entries.push(...collect(root, absolute))
    else entries.push({
      path: relative(root, absolute).split(sep).join('/'),
      kind: status.isFile() ? (/\.(md|markdown)$/i.test(name) ? 'markdown' : 'asset') : 'skipped',
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
      if (entry.kind === 'asset') {
        copyFileSync(join(sourceRoot, entry.path), out)
        assets.push(entry.path)
      } else {
        let sourceText: string
        try { sourceText = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(sourceRoot, entry.path))) }
        catch { throw new Error(`invalid UTF-8 in ${entry.path}`) }
        const result = migrateMarkdown(sourceText)
        writeFileSync(out, result.value)
        files.push({ source: entry.path, output: destination, diagnostics: result.report.diagnostics })
      }
    }
    const review = files.filter((file) => file.diagnostics.some((diagnostic) => diagnostic.fidelity === 'degraded' || diagnostic.fidelity === 'dropped')).map((file) => file.source)
    writeFileSync(join(temporary, 'migration-report.json'), JSON.stringify({ schemaVersion: 1, sourceFormat: 'markdown', files, assets, skipped, review }, null, 2) + '\n')
    if (pathExists(outputRoot)) throw new Error(`output appeared during conversion: ${outputRoot}`)
    renameSync(temporary, outputRoot)
    rmSync(shell, { recursive: true, force: true })
    return { files: files.length, assets: assets.length, review: review.length, skipped: skipped.length, report: join(outputRoot, 'migration-report.json') }
  } catch (error) {
    rmSync(shell, { recursive: true, force: true })
    throw error
  }
}

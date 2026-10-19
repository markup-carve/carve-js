import { chmodSync, closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, lstatSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, posix } from 'node:path'
import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { carveToHtml, migrateMarkdown, parse, renderCarve } from './index.js'
import { headingFragmentAliases, matchingHeadingFragment } from './markdown-heading-fragments.js'

interface Entry { path: string; kind: 'markdown' | 'asset' | 'skipped'; dev: number; ino: number }
interface LinkCheck { target: string; status: 'rewritten' | 'valid' | 'unresolved'; reason?: string }

function htmlIds(html: string): Set<string> {
  const ids = new Set<string>()
  const pending: Html.ParentNode[] = [parseFragment(html)]
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue
      for (const attr of child.attrs) if (attr.name === 'id' || (attr.name === 'name' && child.tagName === 'a')) ids.add(attr.value)
      pending.push(child)
    }
  }
  return ids
}

interface RawUrl { target: string; manual?: boolean }

function normalizeHtmlUrl(value: string): string {
  return value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\n\r]/g, '')
}

function srcsetUrls(value: string): string[] {
  const urls: string[] = []
  let index = 0
  while (index < value.length) {
    while (index < value.length && /[ \t\n\r\f,]/.test(value[index]!)) index++
    const start = index
    while (index < value.length && !/[ \t\n\r\f]/.test(value[index]!)) index++
    const raw = value.slice(start, index)
    const url = raw.replace(/,+$/, '')
    if (url) urls.push(normalizeHtmlUrl(url))
    if (raw.endsWith(',')) continue
    let inParentheses = false
    while (index < value.length) {
      const char = value[index++]!
      if (char === '(') inParentheses = true
      else if (char === ')') inParentheses = false
      else if (char === ',' && !inParentheses) break
    }
  }
  return urls
}

function htmlUrls(html: string): RawUrl[] {
  const urls: RawUrl[] = []
  const pending: Html.ParentNode[] = [parseFragment(html)]
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue
      for (const attr of child.attrs) {
        if (attr.name === 'srcset' || attr.name === 'imagesrcset') {
          if (/\bdata:/i.test(attr.value)) urls.push({ target: attr.value, manual: true })
          else for (const target of srcsetUrls(attr.value)) urls.push({ target })
        } else if (attr.name === 'href' || attr.name === 'src' || attr.name === 'poster'
          || (attr.name === 'data' && child.tagName === 'object')
          || (attr.name === 'action' && child.tagName === 'form')
          || (attr.name === 'formaction' && (child.tagName === 'button' || child.tagName === 'input'))) {
          urls.push({ target: normalizeHtmlUrl(attr.value) })
        }
      }
      pending.push(child)
    }
  }
  return urls
}

function inspectDestination(destination: string, source: string, outputs: Set<string>, ids: Map<string, Set<string>>, aliases: Map<string, Map<string, string | null>>, sources: Set<string>): { href: string; check: LinkCheck } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith('//')) return null
  if (destination.startsWith('/')) return { href: destination, check: { target: destination, status: 'unresolved', reason: 'site-root path needs route mapping' } }
  const match = /^([^?#]*)(\?[^#]*)?(?:#(.*))?$/.exec(destination)
  if (!match) return null
  let pathname: string
  let fragment: string
  try { pathname = decodeURIComponent(match[1]!); fragment = decodeURIComponent(match[3] ?? '') }
  catch { return { href: destination, check: { target: destination, status: 'unresolved', reason: 'invalid URL encoding' } } }
  const target = pathname ? posix.normalize(posix.join(posix.dirname(source), pathname)) : source
  if (target === '..' || target.startsWith('../')) return { href: destination, check: { target: destination, status: 'unresolved', reason: 'outside source directory' } }
  const mapped = /\.(md|markdown)$/i.test(target) ? target.replace(/\.(md|markdown)$/i, '.crv') : target
  if (!outputs.has(mapped) || (mapped !== target && !sources.has(target))) return { href: destination, check: { target: destination, status: 'unresolved', reason: 'target missing from output' } }
  if (fragment && !ids.has(mapped)) return { href: destination, check: { target: destination, status: 'unresolved', reason: 'asset fragment needs site check' } }
  const resolved = fragment ? matchingHeadingFragment(fragment, ids.get(mapped)!, aliases.get(mapped) ?? new Map()) : undefined
  if (fragment && !resolved) return { href: destination, check: { target: destination, status: 'unresolved', reason: 'fragment missing from target' } }
  if (mapped !== target && pathname && !/\.(md|markdown)$/i.test(match[1]!)) return { href: destination, check: { target: destination, status: 'unresolved', reason: 'encoded extension needs manual rewrite' } }
  const newPath = pathname && mapped !== target ? match[1]!.replace(/\.(md|markdown)$/i, '.crv') : match[1]!
  const href = `${newPath}${match[2] ?? ''}${match[3] === undefined ? '' : `#${!fragment || resolved === fragment ? match[3] : encodeURIComponent(resolved!)}`}`
  return { href, check: { target: destination, status: href === destination ? 'valid' : 'rewritten' } }
}

function checkLinks(temporary: string, files: Array<{ source: string; output: string; diagnostics: unknown[]; links?: LinkCheck[] }>, assets: string[]): string[] {
  const outputs = new Set([...files.map((file) => file.output), ...assets])
  const sources = new Set(files.map((file) => file.source))
  const ids = new Map<string, Set<string>>()
  const aliases = new Map<string, Map<string, string | null>>()
  for (const file of files) {
    const source = readFileSync(join(temporary, file.output), 'utf8')
    const html = carveToHtml(source)
    ids.set(file.output, htmlIds(html))
    aliases.set(file.output, headingFragmentAliases(source))
  }
  const broken: string[] = []
  for (const file of files) {
    const path = join(temporary, file.output)
    const original = readFileSync(path, 'utf8')
    const document = parse(original)
    const links: LinkCheck[] = []
    let changed = false
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      if ((node.type === 'raw_inline' || node.type === 'raw_block') && node.format === 'html' && typeof node.content === 'string') {
        for (const url of htmlUrls(node.content)) {
          if (url.manual) { links.push({ target: url.target, status: 'unresolved', reason: 'raw HTML srcset needs manual review' }); continue }
          const result = inspectDestination(url.target, file.source, outputs, ids, aliases, sources)
          if (result) links.push(result.check.status === 'rewritten' ? { target: url.target, status: 'unresolved', reason: 'raw HTML link needs manual rewrite' } : result.check)
        }
      }
      const key = node.type === 'link' ? 'href' : node.type === 'image' ? 'src' : null
      if (key && typeof node[key] === 'string' && node[key]) {
        const result = inspectDestination(node[key], file.source, outputs, ids, aliases, sources)
        if (result) {
          if (result.check.status === 'rewritten' && node.ref) {
            links.push({ target: node[key], status: 'unresolved', reason: 'reference link needs manual rewrite' })
          } else {
            links.push(result.check)
            if (result.href !== node[key]) { node[key] = result.href; changed = true }
          }
        }
      }
      for (const [name, child] of Object.entries(node)) {
        if (name === 'position' || name === 'attrs') continue
        if (Array.isArray(child)) child.forEach(visit)
        else if (child && typeof child === 'object') visit(child)
      }
    }
    visit(document)
    file.links = links
    if (links.some((link) => link.status === 'unresolved')) broken.push(file.source)
    if (changed) writeFileSync(path, renderCarve(document))
  }
  return broken
}

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
  const files: Array<{ source: string; output: string; diagnostics: ReturnType<typeof migrateMarkdown>['report']['diagnostics']; links?: LinkCheck[] }> = []
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
        // Decoded as single-file migration does: ill-formed bytes become U+FFFD (CARVE-P0-023).
        const result = migrateMarkdown(read.bytes.toString('utf8'), { rewriteHeadingFragments: false })
        writeFileSync(out, result.value, { flag: 'wx' })
        files.push({ source: entry.path, output: destination, diagnostics: result.report.diagnostics })
      }
    }
    const broken = new Set(checkLinks(temporary, files, assets))
    const review = files.filter((file) => broken.has(file.source) || file.diagnostics.some((diagnostic) => diagnostic.fidelity === 'degraded' || diagnostic.fidelity === 'dropped')).map((file) => file.source)
    writeFileSync(join(temporary, 'migration-report.json'), JSON.stringify({ schemaVersion: 1, sourceFormat: 'markdown', files, assets, skipped, review }, null, 2) + '\n')
    placeOutput(temporary, outputRoot)
    rmSync(shell, { recursive: true, force: true })
    return { files: files.length, assets: assets.length, review: review.length, skipped: skipped.length, report: join(outputRoot, 'migration-report.json') }
  } catch (error) {
    rmSync(shell, { recursive: true, force: true })
    throw error
  }
}

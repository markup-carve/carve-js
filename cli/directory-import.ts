// The directory import of `carve import --directory` (C2-T-003, C2-M-100): the 0.1 `migrate --from markdown
// --directory` workflow on top of `importDocument`. The output tree is built in a temporary sibling and moved into
// place whole, so a failed run leaves no output.
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { importDocument, type ImportDiagnostic } from '../import/src/index.ts'
import { render, write } from '../src/index.ts'
import type { DocumentNode } from '../src/ast-nodes.ts'

export type DirectoryFormat = 'markdown' | 'gfm'

interface Entry { path: string, kind: 'markdown' | 'asset' | 'skipped', dev: number, ino: number }
export interface LinkCheck { target: string, status: 'rewritten' | 'valid' | 'unresolved', reason?: string }
type ReportDiagnostic = ImportDiagnostic | FragmentDiagnostic
interface FragmentDiagnostic { code: 'link-fragment-case-rewritten', severity: 'hint', channel: 'parse', message: string, path: string }
interface ConvertedFile { source: string, output: string, diagnostics: ReportDiagnostic[], links?: LinkCheck[] }

export interface DirectorySummary { files: number, assets: number, review: number, skipped: number, report: string }

/** A failure of the directory run that names its cause; the CLI gives it the category `usage` or `input-unreadable`. */
export class DirectoryImportError extends Error {
  readonly unreadable: boolean
  constructor(message: string, unreadable = false, options?: ErrorOptions) {
    super(message, options)
    this.unreadable = unreadable
  }
}

const MARKDOWN = /\.(md|markdown)$/i

function elements(html: string): Html.Element[] {
  const found: Html.Element[] = []
  const pending: Html.ParentNode[] = [parseFragment(html)]
  for (let node = pending.pop(); node; node = pending.pop()) {
    for (const child of node.childNodes) {
      if (!('tagName' in child)) continue
      found.push(child)
      pending.push(child)
    }
  }
  return found
}

function attribute(element: Html.Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}

const HEADING = /^h[1-6]$/

/** The ids a link fragment may name in a rendered file, raw HTML included. */
function htmlIds(html: string): Set<string> {
  const ids = new Set<string>()
  for (const element of elements(html)) {
    for (const attr of element.attrs) if (attr.name === 'id' || (attr.name === 'name' && element.tagName === 'a')) ids.add(attr.value)
  }
  return ids
}

/** The Carve heading ids a case-only fragment may stand for, read from a render without raw HTML. */
function headingAliases(html: string): Map<string, string | null> {
  const aliases = new Map<string, string | null>()
  for (const element of elements(html)) {
    const id = attribute(element, 'id')
    const first = element.childNodes.find((child): child is Html.Element => 'tagName' in child)
    const heading = HEADING.test(element.tagName) || (element.tagName === 'section' && first !== undefined && HEADING.test(first.tagName))
    // A suffixed id is the second heading of its text; a case-only fragment never stands for it.
    if (!heading || id === undefined || id === '' || /-(?:[2-9]|[1-9]\d+)$/.test(id)) continue
    const key = id.toLowerCase()
    aliases.set(key, aliases.has(key) && aliases.get(key) !== id ? null : id)
  }
  return aliases
}

interface RawUrl { target: string, manual?: boolean }

function normalizeHtmlUrl(value: string): string {
  return value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\n\r]/g, '')
}

/** The index after the descriptor of one srcset candidate, past its separating comma. */
function skipDescriptor(value: string, start: number): number {
  let index = start
  let inParentheses = false
  while (index < value.length) {
    const char = value[index++]!
    if (char === '(') inParentheses = true
    else if (char === ')') inParentheses = false
    else if (char === ',' && !inParentheses) break
  }
  return index
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
    if (!raw.endsWith(',')) index = skipDescriptor(value, index)
  }
  return urls
}

/** The URL attributes of HTML: those of every element, and those of the elements named. */
const URL_ATTRIBUTES: ReadonlyMap<string, readonly string[] | null> = new Map([
  ['href', null], ['src', null], ['poster', null], ['data', ['object']], ['action', ['form']], ['formaction', ['button', 'input']],
])

function isUrlAttribute(element: Html.Element, name: string): boolean {
  if (!URL_ATTRIBUTES.has(name)) return false
  const tags = URL_ATTRIBUTES.get(name)
  return tags === null || tags!.includes(element.tagName)
}

function attributeUrls(element: Html.Element, name: string, value: string): RawUrl[] {
  if (name !== 'srcset' && name !== 'imagesrcset') return isUrlAttribute(element, name) ? [{ target: normalizeHtmlUrl(value) }] : []
  return /\bdata:/i.test(value) ? [{ target: value, manual: true }] : srcsetUrls(value).map((target) => ({ target }))
}

function htmlUrls(html: string): RawUrl[] {
  return elements(html).flatMap((element) => element.attrs.flatMap((attr) => attributeUrls(element, attr.name, attr.value)))
}

/** A fragment character as a Markdown destination writes it: printable non-ASCII stays, the rest is percent-encoded. */
function encodeFragment(fragment: string): string {
  return Array.from(fragment, (char) => {
    const point = char.codePointAt(0)!
    if (point > 0x7e && !/[\p{White_Space}\p{Cc}]/u.test(char) && !(point >= 0xd800 && point <= 0xdfff)) return char
    return encodeURIComponent(point >= 0xd800 && point <= 0xdfff ? '�' : char)
  }).join('')
}

/**
 * The Markdown libraries percent-encode a non-ASCII destination; the report names a fragment with its non-ASCII
 * characters as an author writes them (CARVE-P2-031 of 0.1).
 */
function authoredFragment(fragment: string): string {
  return fragment.replace(/(?:%[89A-Fa-f][0-9A-Fa-f])+/g, (run) => {
    try { return decodeURIComponent(run) } catch { return run }
  })
}

interface Targets {
  outputs: Set<string>
  sources: Set<string>
  ids: Map<string, Set<string>>
  aliases: Map<string, Map<string, string | null>>
}
interface Inspected { href: string, check: LinkCheck, recased?: { from: string, to: string } }
/** A relative destination split as written (`path`, `query`, `hash`) and decoded (`pathname`, `fragment`). */
interface Local { path: string, query: string, hash: string | undefined, pathname: string, fragment: string }

function unresolved(destination: string, reason: string): Inspected {
  return { href: destination, check: { target: destination, status: 'unresolved', reason } }
}

/** A relative destination split into its parts, an `Inspected` for one refused as it stands, or null for a URL. */
function localDestination(destination: string): Local | Inspected | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(destination) || destination.startsWith('//')) return null
  if (destination.startsWith('/')) return unresolved(destination, 'site-root path needs route mapping')
  const match = /^([^?#]*)(\?[^#]*)?(?:#(.*))?$/.exec(destination)
  if (!match) return null
  try {
    return { path: match[1]!, query: match[2] ?? '', hash: match[3], pathname: decodeURIComponent(match[1]!), fragment: decodeURIComponent(match[3] ?? '') }
  } catch { return unresolved(destination, 'invalid URL encoding') }
}

/** The id a fragment names in the output file `mapped`: itself, or the one heading id it matches by case only. */
function resolveFragment(fragment: string, mapped: string, targets: Targets): string | undefined {
  const ids = targets.ids.get(mapped)!
  return ids.has(fragment) ? fragment : targets.aliases.get(mapped)?.get(fragment.toLowerCase()) ?? undefined
}

/** The file a relative destination names in the output, or the reason it names none. */
function mappedTarget(local: Local, source: string, targets: Targets): { target: string, mapped: string } | string {
  const target = local.pathname ? posix.normalize(posix.join(posix.dirname(source), local.pathname)) : source
  if (target === '..' || target.startsWith('../')) return 'outside source directory'
  const mapped = MARKDOWN.test(target) ? target.replace(MARKDOWN, '.crv') : target
  if (!targets.outputs.has(mapped) || (mapped !== target && !targets.sources.has(target))) return 'target missing from output'
  if (local.fragment && !targets.ids.has(mapped)) return 'asset fragment needs site check'
  return { target, mapped }
}

function inspectDestination(destination: string, source: string, targets: Targets): Inspected | null {
  const local = localDestination(destination)
  if (local === null || 'check' in local) return local
  const found = mappedTarget(local, source, targets)
  if (typeof found === 'string') return unresolved(destination, found)
  const { target, mapped } = found
  const resolved = local.fragment ? resolveFragment(local.fragment, mapped, targets) : undefined
  if (local.fragment && !resolved) return unresolved(destination, 'fragment missing from target')
  const renamed = local.pathname !== '' && mapped !== target
  if (renamed && !MARKDOWN.test(local.path)) return unresolved(destination, 'encoded extension needs manual rewrite')
  return rewritten(destination, local, renamed, resolved)
}

/** The destination with its `.crv` name and its respelled fragment. */
function rewritten(destination: string, local: Local, renamed: boolean, resolved: string | undefined): Inspected {
  const recased = resolved !== undefined && resolved !== local.fragment ? encodeFragment(resolved) : undefined
  const hash = local.hash === undefined ? '' : `#${recased ?? local.hash}`
  const href = `${renamed ? local.path.replace(MARKDOWN, '.crv') : local.path}${local.query}${hash}`
  const check: LinkCheck = { target: destination, status: href === destination ? 'valid' : 'rewritten' }
  return recased === undefined ? { href, check } : { href, check, recased: { from: authoredFragment(local.hash!), to: recased } }
}

function pointerStep(key: string | number): string {
  return `/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`
}

const SKIPPED_FIELDS: ReadonlySet<string> = new Set(['pos', 'segments', 'attrs', 'data', 'metadata'])

/** The local links of one imported tree, checked and, where the check allows, rewritten in place. */
class LinkPass {
  readonly links: LinkCheck[] = []
  changed = false

  private readonly file: ConvertedFile
  private readonly targets: Targets

  constructor(file: ConvertedFile, targets: Targets) {
    this.file = file
    this.targets = targets
  }

  visit(value: unknown, path: string): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((child, index) => this.visit(child, `${path}${pointerStep(index)}`))
      return
    }
    const node = value as Record<string, unknown>
    if ((node.type === 'raw_inline' || node.type === 'raw_block') && node.format === 'html' && typeof node.value === 'string') this.rawHtml(node.value)
    if (node.type === 'link' || node.type === 'image') this.destination(node, node.type === 'link' ? 'href' : 'src', path)
    for (const [name, child] of Object.entries(node)) if (!SKIPPED_FIELDS.has(name)) this.visit(child, `${path}${pointerStep(name)}`)
  }

  /** A URL in raw HTML is checked, never rewritten. */
  private rawHtml(html: string): void {
    for (const url of htmlUrls(html)) {
      if (url.manual) {
        this.links.push({ target: url.target, status: 'unresolved', reason: 'raw HTML srcset needs manual review' })
        continue
      }
      const result = inspectDestination(url.target, this.file.source, this.targets)
      if (result === null) continue
      this.links.push(result.check.status === 'rewritten' ? { target: url.target, status: 'unresolved', reason: 'raw HTML link needs manual rewrite' } : result.check)
    }
  }

  private destination(node: Record<string, unknown>, key: 'href' | 'src', path: string): void {
    const destination = node[key]
    if (typeof destination !== 'string' || destination === '' || (node.targetKind !== undefined && node.targetKind !== 'url')) return
    const result = inspectDestination(destination, this.file.source, this.targets)
    if (result === null) return
    // A reference form keeps its destination in the definition, which the link does not own.
    if (result.check.status === 'rewritten' && typeof node.key === 'string') {
      this.links.push({ target: destination, status: 'unresolved', reason: 'reference link needs manual rewrite' })
      return
    }
    this.links.push(result.check)
    if (result.recased) {
      const { from, to } = result.recased
      this.file.diagnostics.push({ code: 'link-fragment-case-rewritten', severity: 'hint', channel: 'parse', path,
        message: `Rewrote link fragment #${from} to #${to}, the one heading id it matches without regard to case.` })
    }
    if (result.href === destination) return
    node[key] = result.href
    this.changed = true
  }
}

/** Checks and rewrites the local links of one imported tree; true when the tree changed. */
function checkFileLinks(document: DocumentNode, file: ConvertedFile, targets: Targets): boolean {
  const pass = new LinkPass(file, targets)
  pass.visit(document, '')
  file.links = pass.links
  return pass.changed
}

function collect(root: string, dir = root): Entry[] {
  const entries: Entry[] = []
  for (const name of readdirSync(dir).sort()) {
    const absolute = join(dir, name)
    const status = lstatSync(absolute)
    if (status.isDirectory()) entries.push(...collect(root, absolute))
    else entries.push({
      path: relative(root, absolute).split(sep).join('/'),
      kind: status.isFile() ? (MARKDOWN.test(name) ? 'markdown' : 'asset') : 'skipped',
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
    if (parent === ancestor) throw new DirectoryImportError(`cannot resolve output path: ${path}`)
    missing.unshift(basename(ancestor))
    ancestor = parent
  }
  return join(realpathSync(ancestor), ...missing)
}

/** Reads a collected file only if it is still the regular file `collect` saw; a symlink or replaced entry is refused. */
export function readCollectedFile(path: string, expected: { dev: number, ino: number }, label = path): { bytes: Buffer, mode: number } {
  let fd: number
  try { fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new DirectoryImportError(`changed during import: ${label}`, true)
    throw new DirectoryImportError(`cannot read ${label}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`, true)
  }
  try {
    const status = fstatSync(fd)
    if (!status.isFile() || (expected.ino !== 0 && (status.ino !== expected.ino || status.dev !== expected.dev))) {
      throw new DirectoryImportError(`changed during import: ${label}`, true)
    }
    try { return { bytes: readFileSync(fd), mode: status.mode & 0o777 } }
    catch (error) { throw new DirectoryImportError(`cannot read ${label}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`, true) }
  } finally {
    closeSync(fd)
  }
}

/** Moves the finished tree into place. On POSIX, rename() replaces an empty directory, so the path is claimed first. */
export function placeOutput(temporary: string, outputRoot: string): void {
  if (process.platform === 'win32') {
    if (pathExists(outputRoot)) throw new DirectoryImportError(`output appeared during conversion: ${outputRoot}`)
    renameSync(temporary, outputRoot)
    return
  }
  try { mkdirSync(outputRoot) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new DirectoryImportError(`output appeared during conversion: ${outputRoot}`)
    throw error
  }
  try { renameSync(temporary, outputRoot) }
  catch (error) {
    try { rmdirSync(outputRoot) } catch { /* not ours or not empty: leave it */ }
    throw new DirectoryImportError(`output appeared during conversion: ${outputRoot}`, false, { cause: error })
  }
}

function pathExists(path: string): boolean {
  try { lstatSync(path); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const LOSS_CODES: ReadonlySet<string> = new Set(['writer-refused', 'structure-unspellable', 'field-unspellable'])

function isLoss(entry: ReportDiagnostic): boolean {
  // A hint of the loss channel, such as import-whitespace-normalized, changes no visible text.
  return (entry.channel === 'render-loss' && entry.severity !== 'hint') || LOSS_CODES.has(entry.code)
}

interface Imported { file: ConvertedFile, document: DocumentNode, source: string }
interface ImportedTree { imported: Imported[], assets: string[], skipped: string[] }

function copyAsset(bytes: Buffer, mode: number, out: string): void {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, bytes, { flag: 'wx' })
  if (process.platform !== 'win32') chmodSync(out, mode)
}

function importTree(entries: readonly Entry[], sourceRoot: string, temporary: string, from: DirectoryFormat): ImportedTree {
  const tree: ImportedTree = { imported: [], assets: [], skipped: [] }
  const destinations = new Set(['migration-report.json'])
  for (const entry of entries) {
    if (entry.kind === 'skipped') {
      tree.skipped.push(entry.path)
      continue
    }
    const destination = entry.kind === 'markdown' ? entry.path.replace(MARKDOWN, '.crv') : entry.path
    const key = destination.toLowerCase()
    if (destinations.has(key)) throw new DirectoryImportError(`two inputs map to the same output: ${destination}`)
    destinations.add(key)
    const read = readCollectedFile(join(sourceRoot, entry.path), entry, entry.path)
    if (entry.kind === 'asset') {
      copyAsset(read.bytes, read.mode, join(temporary, destination))
      tree.assets.push(entry.path)
      continue
    }
    // Decoded as a single-file import is: ill-formed bytes become U+FFFD.
    const result = importDocument(new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.bytes), { from })
    const file: ConvertedFile = { source: entry.path, output: destination, diagnostics: [...result.diagnostics] }
    tree.imported.push({ file, document: result.document, source: result.source })
  }
  return tree
}

/** The real source root and the output root, refused when the output exists or lies inside the source. */
function roots(source: string, target: string): { sourceRoot: string, outputRoot: string } {
  const sourcePath = resolve(source)
  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) throw new DirectoryImportError(`source is not a directory: ${sourcePath}`)
  const sourceRoot = realpathSync(sourcePath)
  const outputRoot = futurePath(resolve(target))
  if (pathExists(outputRoot)) throw new DirectoryImportError(`output already exists: ${outputRoot}`)
  const nested = relative(sourceRoot, outputRoot)
  if (nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))) {
    throw new DirectoryImportError('output must be outside the source directory')
  }
  return { sourceRoot, outputRoot }
}

/** Writes each imported file after its link pass; returns the files that need review. */
function writeFiles(tree: ImportedTree, temporary: string): string[] {
  const targets: Targets = {
    outputs: new Set([...tree.imported.map((item) => item.file.output), ...tree.assets]),
    sources: new Set(tree.imported.map((item) => item.file.source)),
    ids: new Map(),
    aliases: new Map(),
  }
  for (const item of tree.imported) {
    targets.ids.set(item.file.output, htmlIds(render(item.document, { rawHtml: true })))
    targets.aliases.set(item.file.output, headingAliases(render(item.document)))
  }
  const review: string[] = []
  for (const item of tree.imported) {
    const text = checkFileLinks(item.document, item.file, targets) ? write(item.document) : item.source
    const out = join(temporary, item.file.output)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, text, { flag: 'wx' })
    if (item.file.links!.some((link) => link.status === 'unresolved') || item.file.diagnostics.some(isLoss)) review.push(item.file.source)
  }
  return review
}

/**
 * Imports every Markdown file below `source` into a new directory `target`: `.md` and `.markdown` become `.crv`, other
 * regular files are copied, a local link to a converted file is rewritten to its `.crv` name after its target and
 * fragment are checked, and `migration-report.json` records each file, its diagnostics and links, and what needs review.
 */
export function importMarkdownDirectory(source: string, target: string, from: DirectoryFormat = 'gfm'): DirectorySummary {
  const { sourceRoot, outputRoot } = roots(source, target)
  const entries = collect(sourceRoot)
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  if (!entries.some((entry) => entry.kind === 'markdown')) throw new DirectoryImportError('source contains no Markdown files')
  mkdirSync(dirname(outputRoot), { recursive: true })
  const shell = mkdtempSync(join(dirname(outputRoot), `.${basename(outputRoot)}-`))
  const temporary = join(shell, 'out')
  mkdirSync(temporary)
  try {
    const tree = importTree(entries, sourceRoot, temporary, from)
    const review = writeFiles(tree, temporary)
    const { assets, skipped } = tree
    const files = tree.imported.map((item) => item.file)
    const report = { schemaVersion: 1, sourceFormat: from, files, assets, skipped, review }
    writeFileSync(join(temporary, 'migration-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    placeOutput(temporary, outputRoot)
    return { files: files.length, assets: assets.length, review: review.length, skipped: skipped.length, report: join(outputRoot, 'migration-report.json') }
  } finally {
    rmSync(shell, { recursive: true, force: true })
  }
}

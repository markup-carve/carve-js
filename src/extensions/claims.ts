import { type Attrs, type BlockExtensionNode, type CodeBlockNode, type DivNode, type DocumentNode, forEachSlot,
  type InlineExtensionNode,
  type Node, type SpanNode } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { type ParsedTree } from '../ast-blocks.ts'
import { CarveTreeError, fragmentValidator } from '../ast-validate.ts'
import { addFinding, type Findings } from '../diagnostics.ts'
import { write, writeWithLinkKeys } from '../write.ts'
import { type ExtensionClaim, type ExtensionDefinition, type ExtensionSource } from './types.ts'

/** The link reference definitions of the document whose claims are being read. */
let contextDefinitions: DocumentNode['children'] = []
/**
 * The keys of those definitions, where writing them adds nothing to a body written before them: they write without
 * a loss, and no line of theirs is a colon run that could close a div. Null where that is not known yet.
 */
let contextKeys: ReadonlySet<string> | false | null = null

function definitionKeys(): ReadonlySet<string> | false {
  if (contextKeys !== null) return contextKeys
  try {
    const text = write({ type: 'document', astVersion: '2.0', children: contextDefinitions })
    contextKeys = text.split('\n').some((line) => /^:+$/u.test(line)) ? false
      : new Set(contextDefinitions.flatMap((node) => node.type === 'link_reference_definition' ? [node.key] : []))
  } catch {
    contextKeys = false
  }
  return contextKeys
}

/**
 * C2-X-026, C2-W-089: the body is written in its context, so a reference to a definition outside it keeps its form.
 * The div is the first group of that write and nothing behind it changes it, so the definitions are written once.
 */
function sourceBody(node: DivNode): string {
  const keys = contextKeys ?? (contextDefinitions.length === 0 ? null : definitionKeys())
  const text = keys === false ? write({ type: 'document', astVersion: '2.0', children: [node, ...contextDefinitions] })
    : keys === null ? write({ type: 'document', astVersion: '2.0', children: [node] })
      : writeWithLinkKeys({ type: 'document', astVersion: '2.0', children: [node] }, keys)
  const lines = text.split('\n')
  const opener = lines.findIndex((line) => line.startsWith(':::'))
  const run = /^:+/.exec(lines[opener] ?? '')?.[0] ?? ':::'
  const body = lines.slice(opener + 1, lines.lastIndexOf(run)).join('\n')
  return body === '' ? '' : `${body}\n`
}

export function divSource(node: DivNode, name: string): ExtensionSource {
  const source: ExtensionSource = { form: 'div', name, body: sourceBody(node) }
  if (node.title !== undefined) source.title = plainText(node.title)
  if (node.groupLabel !== undefined) source.groupLabel = node.groupLabel
  return source
}

function claim(node: Node, definition: ExtensionDefinition, sourceNames: ReadonlyMap<Node, string> | null): ExtensionClaim | null {
  const matcher = definition.matcher
  if (matcher === undefined) return null
  switch (matcher.form) {
    case 'div': return node.type === 'div' && sourceNames?.get(node) === matcher.name
      ? divClaim(node, matcher.name, sourceNames) : null
    case 'fence': return node.type === 'code_block' && sourceNames?.get(node) === matcher.name
      ? fenceClaim(node, matcher.name) : null
    case 'inline': return node.type === 'inline_extension' && node.name === matcher.name ? inlineClaim(node, matcher.name) : null
  }
}

function divClaim(node: DivNode, name: string, sourceNames: ReadonlyMap<Node, string>): ExtensionClaim {
  return { form: 'div', name, node, body: node.children,
    sourceName: (child) => sourceNames.get(child),
    ...(node.attrs === undefined ? {} : { attrs: node.attrs }),
    ...(node.title === undefined ? {} : { title: plainText(node.title) }),
    ...(node.groupLabel === undefined ? {} : { label: node.groupLabel }), source: divSource(node, name) }
}

function fenceClaim(node: CodeBlockNode, name: string): ExtensionClaim {
  const source: ExtensionSource = { form: 'fence', name, body: node.value }
  if (node.title !== undefined) source.title = plainText(node.title)
  if (node.groupLabel !== undefined) source.groupLabel = node.groupLabel
  return { form: 'fence', name, node, value: node.value, ...(node.attrs === undefined ? {} : { attrs: node.attrs }), source,
    ...(source.title === undefined ? {} : { title: source.title }),
    ...(source.groupLabel === undefined ? {} : { label: source.groupLabel }) }
}

function inlineClaim(node: InlineExtensionNode, name: string): ExtensionClaim {
  const core: InlineExtensionNode = { type: 'inline_extension', name, children: node.children }
  const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [core] }] }
  const written = write(document)
  const source: ExtensionSource = { form: 'inline', name, body: written.slice(name.length + 2, -2) }
  return { form: 'inline', name, node, children: node.children,
    ...(node.attrs === undefined ? {} : { attrs: node.attrs }), source }
}

interface ParentSlot { name: string, slot: string }

/** One claim pass: the registry, the definitions that can claim each source name, and what every check of a transform shares. */
interface Pass {
  definitions: readonly ExtensionDefinition[]
  /** The definitions with a transform, by `form:name` of their matcher, in registration order. */
  claimants: ReadonlyMap<string, readonly ExtensionDefinition[]>
  /** The check of a transformed node, in a document that declares every registered extension. */
  validate: (children: DocumentNode['children'], registry: readonly ExtensionDefinition[]) => void
  /** The registry a transform in a parent slot is checked against: its own definition without the parent. */
  slotRegistries: Map<ExtensionDefinition, readonly ExtensionDefinition[]>
  sourceNames: ReadonlyMap<Node, string> | null
  findings: Findings
}

function createPass(definitions: readonly ExtensionDefinition[], sourceNames: ReadonlyMap<Node, string> | null,
  findings: Findings): Pass {
  const claimants = new Map<string, ExtensionDefinition[]>()
  for (const definition of definitions) {
    if (definition.transform === undefined || definition.matcher === undefined) continue
    const key = `${definition.matcher.form}:${definition.matcher.name}`
    claimants.set(key, [...claimants.get(key) ?? [], definition])
  }
  const declarations = definitions.map((entry) => ({ name: entry.name, version: entry.version,
    required: false, slots: Object.keys(entry.slots) }))
  const validate = fragmentValidator(declarations)
  return { definitions, claimants, validate, slotRegistries: new Map(), sourceNames, findings }
}

const NO_CLAIMANTS: readonly ExtensionDefinition[] = []

/** The definitions that can claim `node`: only a div, a fence or an inline extension with a matcher name is claimed. */
function claimantsOf(node: Node, pass: Pass): readonly ExtensionDefinition[] {
  if (pass.claimants.size === 0) return NO_CLAIMANTS
  let key: string | undefined
  if (node.type === 'inline_extension') key = `inline:${node.name}`
  else if (node.type === 'div' || node.type === 'code_block') {
    const name = pass.sourceNames?.get(node)
    if (name !== undefined) key = `${node.type === 'div' ? 'div' : 'fence'}:${name}`
  }
  return key === undefined ? NO_CLAIMANTS : pass.claimants.get(key) ?? NO_CLAIMANTS
}

function registryFor(definition: ExtensionDefinition, pass: Pass, parent: ParentSlot | undefined): readonly ExtensionDefinition[] {
  if (parent === undefined) return pass.definitions
  let registry = pass.slotRegistries.get(definition)
  if (registry === undefined) {
    registry = pass.definitions.map((entry) => {
      if (entry !== definition) return entry
      const copy = { ...entry }
      delete copy.parent
      return copy
    })
    pass.slotRegistries.set(definition, registry)
  }
  return registry
}

function validTransform(node: BlockExtensionNode | InlineExtensionNode, input: ExtensionClaim,
  definition: ExtensionDefinition, pass: Pass, parent: ParentSlot | undefined): boolean {
  if (node === undefined || typeof node !== 'object' ||
    node.type !== (input.form === 'inline' ? 'inline_extension' : 'block_extension') ||
    node.name !== definition.name || node.version !== definition.version) return false
  if (definition.parent !== undefined && (definition.parent.name !== parent?.name ||
    definition.parent.slot !== parent.slot)) return false
  attachClaim(node, input, input.node)
  coreFallbacks(node)
  const registry = registryFor(definition, pass, parent)
  const children: DocumentNode['children'] = node.type === 'inline_extension' ?
    [{ type: 'paragraph', children: [node] }] : [node]
  try {
    pass.validate(children, registry)
    return true
  } catch (error) {
    if (error instanceof CarveTreeError || error instanceof RangeError) return false
    throw error
  }
}

function holdsCoreExtension(nodes: readonly Node[]): boolean {
  return nodes.some((node) => {
    if (node.type === 'inline_extension' && !node.name.includes('.')) return true
    let found = false
    forEachSlot(node, (children) => { found ||= holdsCoreExtension(children) })
    return found
  })
}

/** C2-A-124: an unqualified inline extension stands as the span the renderer writes for it (C2-H-076). */
function lowerCoreExtensions(nodes: readonly Node[]): void {
  for (const [at, node] of nodes.entries()) {
    if (node.type === 'inline_extension' && !node.name.includes('.')) {
      lowerCoreExtensions(node.children)
      const { id, keyValues, classes = [] } = node.attrs ?? {}
      const span: SpanNode = { type: 'span', attrs: { ...(id === undefined ? {} : { id }), classes: [`ext-${node.name}`, ...classes],
        ...(keyValues === undefined ? {} : { keyValues }) }, children: node.children }
      if (node.pos !== undefined) span.pos = node.pos
      Reflect.set(nodes, at, span)
      continue
    }
    forEachSlot(node, lowerCoreExtensions)
  }
}

/**
 * C2-X-022: a fallback holds no extension node, so a claimed body copied into one gives each of its core inline
 * extensions as core content. The nodes a transform creates in its slots, as the tabs of a group, are checked too.
 */
function coreFallbacks(node: BlockExtensionNode | InlineExtensionNode): void {
  if (node.fallback !== undefined && holdsCoreExtension(node.fallback)) {
    const fallback = structuredClone(node.fallback)
    lowerCoreExtensions(fallback)
    Reflect.set(node, 'fallback', fallback)
  }
  for (const nodes of Object.values(node.slots ?? {})) {
    for (const child of nodes) {
      if ((child.type === 'block_extension' || child.type === 'inline_extension') && child.name.includes('.')) {
        coreFallbacks(child)
      }
    }
  }
}

function replace(node: Node, pass: Pass, parent?: ParentSlot): Node {
  const { sourceNames, findings } = pass
  for (const definition of claimantsOf(node, pass)) {
    let input: ExtensionClaim | null
    let transformed: BlockExtensionNode | InlineExtensionNode | null
    try {
      input = claim(node, definition, sourceNames)
      if (input === null) continue
      transformed = definition.transform!(input)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      addFinding(findings, node, { code: 'extension-transform-failed', severity: 'warning', channel: 'render-loss',
        message: `The extension ${definition.name} transform failed: ${detail}; the core source node was retained` })
      break
    }
    if (transformed === null) continue
    if (!validTransform(transformed, input, definition, pass, parent)) {
      addFinding(findings, node, { code: 'extension-fallback-rendered', severity: 'warning', channel: 'render-loss',
        message: `Invalid transform of ${definition.name}; the core source node was retained` })
      break
    }
    replaceChildren(transformed, pass)
    return transformed
  }
  replaceChildren(node, pass)
  return node
}

function attachClaim(transformed: BlockExtensionNode | InlineExtensionNode,
  input: ExtensionClaim, node: Node): void {
  transformed.source = input.source
  if (input.attrs !== undefined) {
    const attrs = input.form === 'div' ? remainingAttrs(input.attrs) : input.attrs
    if (attrs !== undefined) transformed.attrs = attrs
  }
  if (node.pos !== undefined) transformed.pos = node.pos
}

export function remainingAttrs(attrs: Attrs): Attrs | undefined {
  const classes = attrs.classes?.slice(1)
  if (attrs.id === undefined && attrs.keyValues === undefined && (classes?.length ?? 0) === 0) return undefined
  return { ...(attrs.id === undefined ? {} : { id: attrs.id }),
    ...(attrs.keyValues === undefined ? {} : { keyValues: attrs.keyValues }),
    ...(classes === undefined || classes.length === 0 ? {} : { classes }) }
}

function slotParent(node: Node, step: string): ParentSlot | undefined {
  if ((node.type !== 'block_extension' && node.type !== 'inline_extension') || !step.startsWith('slots/')) return undefined
  return { name: node.name, slot: step.slice(6).replaceAll('~1', '/').replaceAll('~0', '~') }
}

function replaceChildren(node: Node, pass: Pass): void {
  forEachSlot(node, (nodes, step) => {
    if ((node.type === 'block_extension' || node.type === 'inline_extension') && step === 'fallback') return
    const parent = slotParent(node, step)
    for (const [at, child] of nodes.entries()) {
      Reflect.set(nodes, at, replace(child, pass, parent))
    }
  })
}

/**
 * C2-A-017, C2-N-016: the root declares each qualified extension that a node of the tree names, a name once, the
 * nodes of expanded includes counted too.
 */
export function declareExtensions(document: DocumentNode, definitions: readonly ExtensionDefinition[]): void {
  const used = new Map<string, string>()
  forEachSlot(document, function collect(nodes) {
    for (const node of nodes) {
      if ((node.type === 'block_extension' || node.type === 'inline_extension') && node.name.includes('.') &&
        node.version !== undefined) used.set(node.name, node.version)
      forEachSlot(node, collect)
    }
  })
  if (used.size > 0) document.extensions = [...used].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => ({ name, version, required: false,
      slots: Object.keys(definitions.find((entry) => entry.name === name)?.slots ?? {}) }))
}

/** C2-X-005: a separate pass claims core nodes after the core parse. */
export function applyExtensions(parsed: ParsedTree, definitions: readonly ExtensionDefinition[],
  outerKeys: ReadonlySet<string> | null = null): ParsedTree {
  if (definitions.length === 0) return parsed
  const document = parsed.document
  const sourceNames = parsed.facts?.sourceNames ?? null
  const findings: Findings = { entries: [], nodes: [] }
  const pass = createPass(definitions, sourceNames, findings)
  const previousDefinitions = contextDefinitions
  const previousKeys = contextKeys
  contextDefinitions = document.children.filter((node) => node.type === 'link_reference_definition')
  contextKeys = outerKeys
  try {
    for (const [at, child] of document.children.entries()) {
      Reflect.set(document.children, at, replace(child, pass))
    }
  } finally {
    contextDefinitions = previousDefinitions
    contextKeys = previousKeys
  }
  declareExtensions(document, definitions)
  if (findings.entries.length === 0 || parsed.facts === null) return parsed
  const original = parsed.facts.addFindings
  return { document, facts: { ...parsed.facts, addFindings(target) {
    original(target)
    for (let at = 0; at < findings.entries.length; at++) {
      const entry = findings.entries[at]
      if (entry !== undefined) addFinding(target, findings.nodes[at] ?? null, entry)
    }
  } } }
}

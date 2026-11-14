// The 19 options of C2-H-137. An option this engine does not offer is refused, not ignored.
import {
  BOOLEAN_DEFAULTS, DEFAULT_DENIED_SCHEMES, DEFAULT_LABELS, ENUM_DEFAULTS, ENUM_VALUES, NULL_DEFAULTS, OPTION_KINDS, OPTION_TYPES,
} from './option-tables.ts'

export type HeadingIds = 'off' | 'keep-case' | 'lower' | 'ascii'
export type Mode = 'interactive' | 'static'
export type Profile = 'full' | 'article' | 'comment' | 'minimal'

/** C2-H-128: a deny list or an allow list of URL schemes. There is no off value. */
export interface UrlPolicy {
  deny?: readonly string[]
  allow?: readonly string[]
}

/** C2-H-126: URL templates, in which `{name}` stands for the encoded name, or resolvers. */
export interface Social {
  mentionUrl?: string
  tagUrl?: string
  resolveMention?: (name: string) => string | null | undefined
  resolveTag?: (name: string) => string | null | undefined
}

export interface Options {
  extensions?: readonly unknown[]
  includes?: unknown
  headingIds?: HeadingIds
  mode?: Mode
  renderers?: Readonly<Record<string, unknown>>
  symbols?: Readonly<Record<string, string>>
  labels?: Readonly<Record<string, string>>
  social?: Social | null
  sourceLines?: boolean
  sections?: boolean
  smartTypography?: boolean
  roundtrip?: boolean
  rawHtml?: boolean
  urlPolicy?: UrlPolicy
  profile?: Profile
  strictLosses?: boolean
  alignTables?: boolean
  rules?: Readonly<Record<string, boolean>>
  platforms?: readonly string[]
}

/** The options a parse reads, and whether the tree carries positions (C2-A-138). */
export interface ParseOptions extends Pick<Options, 'extensions' | 'includes' | 'headingIds'> {
  positions?: boolean
}

export type RenderOptions = Omit<Options, 'alignTables' | 'rules' | 'platforms'>

/** The options with every default filled in. */
export interface Settings {
  headingIds: HeadingIds
  mode: Mode
  symbols: Readonly<Record<string, string>>
  labels: Readonly<Record<string, string>>
  social: Social | null
  sourceLines: boolean
  sections: boolean
  smartTypography: boolean
  roundtrip: boolean
  rawHtml: boolean
  denied: ReadonlySet<string> | null
  allowed: ReadonlySet<string> | null
  profile: Profile
  strictLosses: boolean
}

/** An option that has an unknown name or value, or that this engine does not offer. */
export class CarveOptionError extends Error {
  option: string

  constructor(option: string, message: string) {
    super(`option ${option}: ${message}`)
    this.name = 'CarveOptionError'
    this.option = option
  }
}

type OptionMap = Readonly<Record<string, unknown>>

/** Whether a value of the declared type of its option asks for nothing: an empty list or map, or no value. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  return isPlainObject(value) && Object.keys(value).length === 0
}

function enumValue(options: OptionMap, name: string): string {
  const value = options[name]
  if (value === undefined) return ENUM_DEFAULTS.get(name)!
  if (typeof value !== 'string' || !ENUM_VALUES.get(name)!.includes(value)) {
    throw new CarveOptionError(name, `unknown value ${JSON.stringify(value)}`)
  }
  return value
}

function booleanValue(options: OptionMap, name: string): boolean {
  const value = options[name]
  if (value === undefined) return BOOLEAN_DEFAULTS.get(name)!
  if (typeof value !== 'boolean') throw new CarveOptionError(name, 'not a boolean')
  return value
}

function schemeSet(policy: UrlPolicy, field: 'deny' | 'allow'): ReadonlySet<string> | null {
  const list = policy[field]
  return list === undefined ? null : new Set(list.map((scheme) => scheme.toLowerCase()))
}

/** A record such as an object literal or JSON gives: not an array, a Map or an instance of another class. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// The type of the items of each list and map option (spec/0.2/data/options.json).
const ITEM_TYPES = new Map([['labels', 'string'], ['symbols', 'string'], ['rules', 'boolean'], ['platforms', 'string']])
const STRUCTURE_NAMES = new Map([
  ['includes', 'an include root or resolver'], ['social', 'an object'], ['urlPolicy', 'an object with a deny list or an allow list'],
])

function checkItems(name: string, items: readonly unknown[], what: string): void {
  const type = ITEM_TYPES.get(name)
  if (type !== undefined && !items.every((item) => typeof item === type)) throw new CarveOptionError(name, `not ${what} of ${type}s`)
}

/** The test of each declared type: the reason a value of the option `name` is refused, or null. */
const TYPE_CHECKS = new Map<string, (name: string, value: unknown) => string | null>([
  ['boolean', (_name, value) => (typeof value === 'boolean' ? null : 'not a boolean')],
  ['enum', (name, value) => {
    if (typeof value === 'string' && ENUM_VALUES.get(name)!.includes(value)) return null
    return `unknown value ${JSON.stringify(value) ?? typeof value}`
  }],
  ['list', (name, value) => {
    if (!Array.isArray(value)) return 'not a list'
    checkItems(name, value, 'a list')
    return null
  }],
  ['map', (name, value) => {
    if (!isPlainObject(value)) return 'not a map'
    checkItems(name, Object.values(value), 'a map')
    return null
  }],
  ['structure', (name, value) => {
    const resolver = name === 'includes' && (typeof value === 'string' || typeof value === 'function')
    return isPlainObject(value) || resolver ? null : `not ${STRUCTURE_NAMES.get(name)!}`
  }],
])

/**
 * C2-H-137: refuses a value that is not of the declared type of the option `name`, before anything
 * else is read of it. Null is a value only of an option whose default is null.
 */
export function checkType(name: string, value: unknown): void {
  if (value === undefined || (value === null && NULL_DEFAULTS.includes(name))) return
  const reason = TYPE_CHECKS.get(OPTION_TYPES.get(name)!)!(name, value)
  if (reason !== null) throw new CarveOptionError(name, reason)
}

/** C2-H-128: a deny list or an allow list of schemes, each a list of strings. An absent policy is the default deny list. */
function urlPolicyValue(options: OptionMap): UrlPolicy {
  const value = options['urlPolicy']
  if (value === undefined) return {}
  if (!isPlainObject(value)) throw new CarveOptionError('urlPolicy', 'not an object with a deny list or an allow list')
  for (const name of Object.keys(value)) {
    if (name !== 'deny' && name !== 'allow') throw new CarveOptionError('urlPolicy', `unknown field ${name}`)
    const list = value[name]
    if (!Array.isArray(list) || !list.every((scheme) => typeof scheme === 'string')) {
      throw new CarveOptionError('urlPolicy', `${name} is not a list of strings`)
    }
  }
  if (value['deny'] !== undefined && value['allow'] !== undefined) {
    throw new CarveOptionError('urlPolicy', 'both a deny list and an allow list')
  }
  return value as UrlPolicy
}

/** A map whose values are strings (C2-H-124, C2-H-125). An absent map, or null, is the default. */
function stringMap(options: OptionMap, name: string): Readonly<Record<string, string>> | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  if (!isPlainObject(value) || !Object.values(value).every((text) => typeof text === 'string')) {
    throw new CarveOptionError(name, 'not a map of strings')
  }
  return value as Readonly<Record<string, string>>
}

const SOCIAL_FIELDS = new Map([['mentionUrl', 'string'], ['tagUrl', 'string'], ['resolveMention', 'function'], ['resolveTag', 'function']])

/** C2-H-126: URL templates and resolvers, or null for none. */
function socialValue(options: OptionMap): Social | null {
  const value = options['social']
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)) throw new CarveOptionError('social', 'not an object')
  for (const [name, field] of Object.entries(value)) {
    const kind = SOCIAL_FIELDS.get(name)
    if (kind === undefined) throw new CarveOptionError('social', `unknown field ${name}`)
    if (field !== undefined && typeof field !== kind) throw new CarveOptionError('social', `${name} is not a ${kind}`)
  }
  return value as Social
}

/** C2-H-137: refuses a name that is no option and a value of the wrong type. `positions` is a boolean the parse reads. */
function checkValues(given: OptionMap, names: readonly string[], stage: 'parse' | 'render'): void {
  for (const name of names) {
    if (name === 'positions' && stage === 'parse') {
      if (given[name] !== undefined && typeof given[name] !== 'boolean') throw new CarveOptionError(name, 'not a boolean')
    } else if (OPTION_KINDS.has(name)) checkType(name, given[name])
    else throw new CarveOptionError(name, 'unknown option')
  }
}

/** C2-H-137: then refuses an option of another stage, and one this engine does not offer. */
function checkNames(given: OptionMap, stage: 'parse' | 'render'): void {
  const names = Object.keys(given)
  checkValues(given, names, stage)
  for (const name of names) {
    const kind = OPTION_KINDS.get(name)
    if (kind === 'format' || kind === 'lint' || (stage === 'parse' && kind === 'render')) {
      throw new CarveOptionError(name, `not an option of ${stage}`)
    }
  }
  // 0.2.0 has no extension API, expands no include and has no build-time renderer.
  for (const name of ['extensions', 'includes', 'renderers']) {
    if (!isEmpty(given[name])) throw new CarveOptionError(name, 'not offered by this engine')
  }
}

/**
 * Checks `options` against the option list and returns them with their defaults. `stage` is
 * `parse` or `render`: an option of another stage is refused there.
 */
export function readOptions(options: object | undefined, stage: 'parse' | 'render'): Settings {
  const given: OptionMap = (options ?? {}) as OptionMap
  checkNames(given, stage)
  const policy = urlPolicyValue(given)
  const allowed = schemeSet(policy, 'allow')
  return {
    headingIds: enumValue(given, 'headingIds') as HeadingIds,
    mode: enumValue(given, 'mode') as Mode,
    symbols: stringMap(given, 'symbols') ?? {},
    labels: { ...DEFAULT_LABELS, ...stringMap(given, 'labels') },
    social: socialValue(given),
    sourceLines: booleanValue(given, 'sourceLines'),
    sections: booleanValue(given, 'sections'),
    smartTypography: booleanValue(given, 'smartTypography'),
    roundtrip: booleanValue(given, 'roundtrip'),
    rawHtml: booleanValue(given, 'rawHtml'),
    denied: allowed === null ? schemeSet(policy, 'deny') ?? new Set(DEFAULT_DENIED_SCHEMES) : null,
    allowed,
    profile: enumValue(given, 'profile') as Profile,
    strictLosses: booleanValue(given, 'strictLosses'),
  }
}

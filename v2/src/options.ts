// The 19 options of C2-H-137. An option this engine does not offer is refused, not ignored.
import {
  BOOLEAN_DEFAULTS, DEFAULT_DENIED_SCHEMES, DEFAULT_LABELS, ENUM_DEFAULTS, ENUM_VALUES, OPTION_KINDS,
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

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
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

/** C2-H-137: refuses a name that is no option, an option of another stage, and one this engine does not offer. */
function checkNames(given: OptionMap, stage: 'parse' | 'render'): void {
  for (const name of Object.keys(given)) {
    if (name === 'positions' && stage === 'parse') continue
    const kind = OPTION_KINDS.get(name)
    if (kind === undefined) throw new CarveOptionError(name, 'unknown option')
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
  const policy = (given['urlPolicy'] ?? {}) as UrlPolicy
  const allowed = schemeSet(policy, 'allow')
  return {
    headingIds: enumValue(given, 'headingIds') as HeadingIds,
    mode: enumValue(given, 'mode') as Mode,
    symbols: (given['symbols'] ?? {}) as Readonly<Record<string, string>>,
    labels: { ...DEFAULT_LABELS, ...(given['labels'] as Readonly<Record<string, string>> | undefined) },
    social: (given['social'] ?? null) as Social | null,
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

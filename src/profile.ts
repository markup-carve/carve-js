/*
 * Profile-based feature restriction (core, port of carve-php's Profile +
 * LinkPolicy + ProfileFilter).
 *
 * A Profile controls which markup *features* survive into the output,
 * independent of XSS sanitization (`sanitizeUrls`). It runs as an AST
 * transform between resolve() and render(), so it holds identically for the
 * HTML, Markdown, plain-text and ANSI renderers.
 *
 * The allow/deny lists, presets and resolution semantics match carve-php
 * byte-for-byte. They are expressed in the canonical snake_case node-type
 * vocabulary (see CANONICAL_*). carve-js AST nodes use different internal
 * `type` strings (kebab-case / variants); `canonicalType()` maps every
 * block/inline node to its canonical name before the allow/deny check.
 */

import type { AnyNode, Attrs, Document } from './ast.js'

/** Action taken on a disallowed node. */
export type DisallowedAction = 'strip' | 'to_text' | 'error'

/**
 * Canonical block node-type vocabulary (snake_case). These are the strings a
 * profile's allow/deny lists use; they are portable across implementations.
 */
export const CANONICAL_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'code_block',
  'block_quote',
  'list',
  'list_item',
  'table',
  'table_row',
  'table_cell',
  'thematic_break',
  'div',
  'raw_block',
  'footnote',
  'definition_list',
  'definition_term',
  'definition_description',
  'section',
  'line_block',
  'comment',
  'figure',
  'caption',
] as const

/** Canonical inline node-type vocabulary (snake_case). */
export const CANONICAL_INLINE_TYPES = [
  'text',
  'emphasis',
  'strong',
  'underline',
  'strike',
  'inline_extension',
  'mention',
  'code',
  'link',
  'image',
  'soft_break',
  'hard_break',
  'raw_inline',
  'escaped_text',
  'footnote_ref',
  'inline_footnote',
  'span',
  'superscript',
  'subscript',
  'highlight',
  'insert',
  'delete',
  'symbol',
  'math',
  'abbreviation',
  'literal_inline',
] as const

const BLOCK_SET: ReadonlySet<string> = new Set(CANONICAL_BLOCK_TYPES)
const INLINE_SET: ReadonlySet<string> = new Set(CANONICAL_INLINE_TYPES)

/**
 * Map a carve-js internal `node.type` to its canonical snake_case name.
 *
 * Returns `undefined` for types that have no canonical mapping (e.g.
 * `crossref`, `caption-number`, `abbreviation-def`, `critic-*`);
 * such nodes are denied-by-default by the profile resolver, matching
 * carve-php's "unknown type -> denied" rule. The exception is `document`,
 * which the resolver always treats as allowed.
 */
export function canonicalType(type: string): string | undefined {
  switch (type) {
    // ----- block -----
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return 'heading'
    case 'code-block':
      return 'code_block'
    case 'blockquote':
      return 'block_quote'
    case 'list':
      return 'list'
    case 'list-item':
      return 'list_item'
    case 'table':
      return 'table'
    case 'table-row':
      return 'table_row'
    case 'table-cell':
      return 'table_cell'
    case 'thematic-break':
      return 'thematic_break'
    case 'div':
      return 'div'
    // An admonition is a typed div; carve-php has no separate admonition node,
    // it is a Div. Treat it under the `div` feature for allow/deny purposes.
    case 'admonition':
      return 'div'
    case 'raw-block':
      return 'raw_block'
    case 'definition-list':
      return 'definition_list'
    case 'figure':
      return 'figure'
    case 'comment':
      return 'comment'
    // ----- inline -----
    case 'text':
      return 'text'
    case 'italic':
      return 'emphasis'
    case 'strong':
      return 'strong'
    case 'underline':
      return 'underline'
    case 'strike':
      return 'strike'
    case 'extension':
      return 'inline_extension'
    case 'mention':
      return 'mention'
    // carve-php treats `#tag` under the mention feature.
    case 'tag':
      return 'mention'
    case 'code':
      return 'code'
    case 'link':
      return 'link'
    // An angle autolink is a link.
    case 'autolink':
      return 'link'
    case 'image':
      return 'image'
    case 'soft-break':
      return 'soft_break'
    case 'hard-break':
      return 'hard_break'
    case 'raw-inline':
      return 'raw_inline'
    case 'literal-inline':
      // An inline literal gets its OWN canonical type rather than aliasing
      // onto `text`. Its content is escaped, so its trust level does match a
      // text node -- but when it carries attributes it renders a `<span>`, and
      // the `comment` / `minimal` presets deliberately exclude `span` from
      // their allowlists. Reporting it as `text` therefore let untrusted input
      // smuggle `<span class="...">` past those presets. A distinct type keeps
      // the allowlists fail-closed (an unknown type is denied, §profiles) and
      // lets a host allow or deny the construct on purpose.
      return 'literal_inline'
    case 'footnote':
      // Inline footnote (`^[...]`) carries `inline`; a reference (`[^id]`)
      // does not. carve-php denies both under the footnote family, so the
      // mapping does not matter for allow/deny, but we distinguish so a
      // profile could allow one and not the other.
      return undefined // handled specially in resolveType via node shape
    case 'span':
      return 'span'
    case 'super':
      return 'superscript'
    case 'sub':
      return 'subscript'
    case 'highlight':
      return 'highlight'
    case 'critic-insert':
      return 'insert'
    case 'critic-delete':
      return 'delete'
    case 'symbol':
      return 'symbol'
    case 'math':
      return 'math'
    case 'abbreviation':
      return 'abbreviation'
    default:
      // 'crossref', 'caption-number', 'abbreviation-def',
      // 'critic-substitute', 'critic-comment', 'bold-italic' (handled below)
      return undefined
  }
}

/**
 * Link URL policy for Profile-based filtering. Controls which URLs are
 * allowed in links and images. Port of carve-php's LinkPolicy.
 */
export class LinkPolicy {
  private allowedSchemes: string[] | null = null
  private deniedSchemes: string[] = ['javascript', 'vbscript', 'data', 'file']
  private allowedDomains: string[] | null = null
  private deniedDomains: string[] = []
  private allowExternal = true
  private allowInternal = true
  private relAttributes: string[] = []

  /** Allow all URLs except dangerous schemes. */
  static unrestricted(): LinkPolicy {
    return new LinkPolicy()
  }

  /** Allow only internal links (relative URLs, fragments). */
  static internalOnly(): LinkPolicy {
    return new LinkPolicy().setAllowExternal(false)
  }

  /** Allow only links to specific domains. */
  static allowlist(domains: string[]): LinkPolicy {
    return new LinkPolicy().setAllowedDomains(domains)
  }

  getAllowedSchemes(): string[] | null {
    return this.allowedSchemes
  }

  setAllowedSchemes(schemes: string[] | null): this {
    this.allowedSchemes = schemes !== null ? schemes.map((s) => s.toLowerCase()) : null
    return this
  }

  getDeniedSchemes(): string[] {
    return this.deniedSchemes
  }

  setDeniedSchemes(schemes: string[]): this {
    this.deniedSchemes = schemes.map((s) => s.toLowerCase())
    return this
  }

  getAllowedDomains(): string[] | null {
    return this.allowedDomains
  }

  setAllowedDomains(domains: string[] | null): this {
    this.allowedDomains = domains
    return this
  }

  getDeniedDomains(): string[] {
    return this.deniedDomains
  }

  setDeniedDomains(domains: string[]): this {
    this.deniedDomains = domains
    return this
  }

  getAllowExternal(): boolean {
    return this.allowExternal
  }

  setAllowExternal(allow: boolean): this {
    this.allowExternal = allow
    return this
  }

  getAllowInternal(): boolean {
    return this.allowInternal
  }

  setAllowInternal(allow: boolean): this {
    this.allowInternal = allow
    return this
  }

  getRelAttributes(): string[] {
    return this.relAttributes
  }

  setRelAttributes(attrs: string[]): this {
    this.relAttributes = attrs
    return this
  }

  /** Add a rel attribute applied to all surviving links. */
  addRelAttribute(attr: string): this {
    if (!this.relAttributes.includes(attr)) {
      this.relAttributes.push(attr)
    }
    return this
  }

  /**
   * Check whether a URL is permitted by this policy.
   *
   * @param baseHost Current document's host (for external detection).
   */
  isUrlAllowed(url: string, baseHost: string | null = null): boolean {
    url = url.trim()
    if (url === '') return true

    // Fragment-only URLs are always internal.
    if (url.startsWith('#')) return this.allowInternal

    // Protocol-relative URLs are absolute external URLs, not internal paths.
    if (url.startsWith('//')) return this.isProtocolRelativeUrlAllowed(url, baseHost)

    // Relative paths are internal.
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return this.allowInternal
    }

    const colonPos = url.indexOf(':')
    if (colonPos !== -1) {
      const scheme = url.slice(0, colonPos).toLowerCase()

      if (this.deniedSchemes.includes(scheme)) return false
      if (this.allowedSchemes !== null && !this.allowedSchemes.includes(scheme)) return false

      // mailto: and tel: are considered internal for simplicity.
      if (scheme === 'mailto' || scheme === 'tel') return true

      if (scheme === 'http' || scheme === 'https') {
        const host = parseHost(url)
        if (host !== null) {
          if (this.isDomainDenied(host)) return false
          if (this.allowedDomains !== null && !this.isDomainAllowed(host)) return false
          if (!this.allowExternal) {
            if (baseHost !== null && !this.isSameHost(host, baseHost)) return false
            if (baseHost === null) return false
          }
        }
      }
    }

    return true
  }

  private isProtocolRelativeUrlAllowed(url: string, baseHost: string | null): boolean {
    if (this.allowedSchemes !== null) {
      const schemes = this.allowedSchemes.map((s) => s.toLowerCase())
      if (!schemes.includes('http') && !schemes.includes('https')) return false
    }

    const host = parseHost('https:' + url)
    if (host === null) return false
    if (this.isDomainDenied(host)) return false
    if (this.allowedDomains !== null && !this.isDomainAllowed(host)) return false
    if (!this.allowExternal) {
      if (baseHost !== null && !this.isSameHost(host, baseHost)) return false
      if (baseHost === null) return false
    }
    return true
  }

  private isDomainDenied(host: string): boolean {
    host = host.toLowerCase()
    return this.deniedDomains.some(
      (d) => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()),
    )
  }

  private isDomainAllowed(host: string): boolean {
    if (this.allowedDomains === null) return true
    host = host.toLowerCase()
    return this.allowedDomains.some(
      (d) => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()),
    )
  }

  private isSameHost(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/**
 * Extract the host of an http(s) URL the way PHP's parse_url does for the
 * cases LinkPolicy needs (host only, no userinfo handling beyond `@`).
 * Returns null when no host can be determined.
 */
function parseHost(url: string): string | null {
  // Match scheme://[authority]/...; authority ends at /, ?, or #.
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/.exec(url)
  if (!m) return null
  let authority = m[1]!
  // Strip userinfo.
  const at = authority.lastIndexOf('@')
  if (at !== -1) authority = authority.slice(at + 1)
  // Strip port. IPv6 literals are in [..]; keep brackets out of scope (rare).
  const colon = authority.lastIndexOf(':')
  if (colon !== -1 && !authority.includes(']')) authority = authority.slice(0, colon)
  return authority === '' ? null : authority
}

/**
 * Profile: feature restriction for a rendering context. Port of carve-php's
 * Profile, including the four presets (full / article / comment / minimal).
 */
export class Profile {
  static readonly ACTION_STRIP: DisallowedAction = 'strip'
  static readonly ACTION_TO_TEXT: DisallowedAction = 'to_text'
  static readonly ACTION_ERROR: DisallowedAction = 'error'

  /**
   * Default maximum input length (UTF-8 bytes) for the untrusted `comment`
   * preset - a DoS backstop enforced pre-parse. Generous for a comment body;
   * override with `setMaxLength(0)` to disable or another value to retune.
   */
  static readonly COMMENT_MAX_LENGTH = 100_000
  /**
   * Default maximum input length (UTF-8 bytes) for the untrusted `minimal`
   * preset (chat / micro-posts). Override with `setMaxLength(...)` as needed.
   */
  static readonly MINIMAL_MAX_LENGTH = 10_000

  private name = 'custom'
  private description = ''
  private featureReasons: Record<string, string> = {}
  private allowedInline: string[] | null = null
  private allowedBlock: string[] | null = null
  private deniedInline: string[] = []
  private deniedBlock: string[] = []
  private linkPolicy: LinkPolicy | null = null
  private maxNesting = 0
  private maxLength = 0
  private disallowedAction: DisallowedAction = Profile.ACTION_TO_TEXT

  /** All features enabled. Use only for trusted content. */
  static full(): Profile {
    const p = new Profile()
    p.name = 'full'
    p.description = 'All features enabled. Use only for trusted content.'
    return p
  }

  /** Blog posts and articles: all formatting, no raw HTML. */
  static article(): Profile {
    const p = new Profile()
    p.name = 'article'
    p.description = 'Blog posts and articles. All formatting, no raw HTML.'
    p.denyBlock(['raw_block']).denyInline(['raw_inline'])
    p.featureReasons = {
      raw_block: 'Raw HTML blocks are disabled to prevent XSS attacks. Use djot markup instead.',
      raw_inline: 'Raw HTML is disabled to prevent XSS attacks. Use djot markup instead.',
    }
    return p
  }

  /** User comments: basic formatting only, nofollow links. */
  static comment(): Profile {
    const p = new Profile()
    p.name = 'comment'
    p.description = 'User comments. Basic formatting only, nofollow links.'
    p.allowInline([
      'text',
      'emphasis',
      'strong',
      'underline',
      'strike',
      'inline_extension',
      'mention',
      'code',
      'link',
      'soft_break',
      'hard_break',
      'delete',
      'insert',
      'highlight',
      'superscript',
      'subscript',
    ])
      .allowBlock(['paragraph', 'list', 'list_item', 'block_quote', 'code_block'])
      .setLinkPolicy(
        LinkPolicy.unrestricted().addRelAttribute('nofollow').addRelAttribute('ugc'),
      )
      .setMaxNesting(4)
      .setMaxLength(Profile.COMMENT_MAX_LENGTH)
    p.featureReasons = {
      heading: 'Headings are disabled in comments to prevent disrupting page structure.',
      image: 'Images are disabled to prevent spam, inappropriate content, and bandwidth abuse.',
      table: 'Tables are disabled as they are too complex for comment formatting.',
      footnote: 'Footnotes are disabled as they are unnecessary for comments.',
      footnote_ref: 'Footnotes are disabled as they are unnecessary for comments.',
      inline_footnote: 'Footnotes are disabled as they are unnecessary for comments.',
      raw_block: 'Raw HTML is disabled for security reasons.',
      raw_inline: 'Raw HTML is disabled for security reasons.',
      div: 'Custom containers are disabled in comments.',
      section: 'Sections are disabled in comments.',
      definition_list: 'Definition lists are disabled in comments.',
      definition_term: 'Definition lists are disabled in comments.',
      definition_description: 'Definition lists are disabled in comments.',
      thematic_break: 'Horizontal rules are disabled in comments.',
      line_block: 'Line blocks are disabled in comments.',
      span: 'Custom spans are disabled in comments.',
      symbol: 'Symbol markup is disabled in comments.',
      math: 'Math markup is disabled in comments.',
      abbreviation: 'Abbreviations are disabled in comments.',
    }
    return p
  }

  /** Chat / micro-posts: non-destructive inline formatting, paragraphs and lists. */
  static minimal(): Profile {
    const p = new Profile()
    p.name = 'minimal'
    p.description =
      'Chat/micro-posts. Non-destructive inline formatting, paragraphs and lists.'
    p.allowInline([
      'text',
      'emphasis',
      'strong',
      'underline',
      'strike',
      'inline_extension',
      'mention',
      'code',
      'delete',
      'insert',
      'superscript',
      'subscript',
      'soft_break',
      'hard_break',
    ])
      .allowBlock(['paragraph', 'list', 'list_item'])
      .setMaxNesting(2)
      .setMaxLength(Profile.MINIMAL_MAX_LENGTH)
    p.featureReasons = {
      link: 'Links are disabled in this minimal context.',
      highlight: 'Highlighting is disabled in this minimal context.',
      image: 'Images are disabled in this minimal context.',
      raw_inline: 'Raw HTML is disabled for security reasons.',
      footnote_ref: 'Footnotes are disabled in this minimal context.',
      inline_footnote: 'Footnotes are disabled in this minimal context.',
      span: 'Custom spans are disabled in this minimal context.',
      symbol: 'Symbols are disabled in this minimal context.',
      math: 'Math is disabled in this minimal context.',
      abbreviation: 'Abbreviations are disabled in this minimal context.',
      default: 'Only basic text formatting and lists are allowed in this context.',
    }
    return p
  }

  getName(): string {
    return this.name
  }

  getDescription(): string {
    return this.description
  }

  /** Reason a node type is disallowed, or null if it is allowed / no reason. */
  getReasonDisallowed(canonical: string): string | null {
    if (this.isTypeAllowed(canonical)) return null
    return this.featureReasons[canonical] ?? this.featureReasons['default'] ?? null
  }

  getFeatureReasons(): Record<string, string> {
    return this.featureReasons
  }

  setFeatureReason(canonical: string, reason: string): this {
    this.featureReasons[canonical] = reason
    return this
  }

  /** Set allowed inline types (null = all allowed). */
  allowInline(types: string[] | null): this {
    this.allowedInline = types
    return this
  }

  /** Set allowed block types (null = all allowed). */
  allowBlock(types: string[] | null): this {
    this.allowedBlock = types
    return this
  }

  denyInline(types: string[]): this {
    this.deniedInline = [...this.deniedInline, ...types]
    return this
  }

  denyBlock(types: string[]): this {
    this.deniedBlock = [...this.deniedBlock, ...types]
    return this
  }

  getAllowedInline(): string[] | null {
    return this.allowedInline
  }

  getAllowedBlock(): string[] | null {
    return this.allowedBlock
  }

  getDeniedInline(): string[] {
    return this.deniedInline
  }

  getDeniedBlock(): string[] {
    return this.deniedBlock
  }

  getLinkPolicy(): LinkPolicy | null {
    return this.linkPolicy
  }

  setLinkPolicy(policy: LinkPolicy | null): this {
    this.linkPolicy = policy
    return this
  }

  getMaxNesting(): number {
    return this.maxNesting
  }

  /** Set maximum block-container nesting depth (0 = unlimited). */
  setMaxNesting(max: number): this {
    this.maxNesting = max
    return this
  }

  getMaxLength(): number {
    return this.maxLength
  }

  /** Set maximum input length in bytes (0 = unlimited). */
  setMaxLength(max: number): this {
    this.maxLength = max
    return this
  }

  getDisallowedAction(): DisallowedAction {
    return this.disallowedAction
  }

  /** Set action for disallowed elements. */
  onDisallowed(action: DisallowedAction): this {
    this.disallowedAction = action
    return this
  }

  /** Whether a canonical type string is allowed by this profile. */
  isTypeAllowed(canonical: string): boolean {
    if (INLINE_SET.has(canonical)) return this.isInlineAllowed(canonical)
    if (BLOCK_SET.has(canonical)) return this.isBlockAllowed(canonical)
    if (canonical === 'document') return true
    // Unknown types are denied by default.
    return false
  }

  private isInlineAllowed(type: string): boolean {
    if (this.deniedInline.includes(type)) return false
    if (this.allowedInline !== null) return this.allowedInline.includes(type)
    return true
  }

  private isBlockAllowed(type: string): boolean {
    if (this.deniedBlock.includes(type)) return false
    if (this.allowedBlock !== null) return this.allowedBlock.includes(type)
    return true
  }

  /** Summary of what this profile allows/denies. */
  getSummary(): {
    name: string
    description: string
    allowed_block: string[] | 'all'
    allowed_inline: string[] | 'all'
    denied_block: string[]
    denied_inline: string[]
  } {
    return {
      name: this.name,
      description: this.description,
      allowed_block: this.allowedBlock ?? 'all',
      allowed_inline: this.allowedInline ?? 'all',
      denied_block: this.deniedBlock,
      denied_inline: this.deniedInline,
    }
  }
}

/** A recorded profile violation (surfaced when action = error). */
export interface ProfileViolation {
  /** Canonical node type that was disallowed. */
  nodeType: string
  /** Machine reason: element_not_allowed | max_nesting_exceeded | link_not_allowed | image_not_allowed. */
  reason: string
  /** Human-readable feature reason from the profile, if any. */
  reasonDescription: string | null
}

/** Format a violation into a human-readable message (matches carve-php). */
export function formatProfileViolation(v: ProfileViolation): string {
  let msg = `'${v.nodeType}' is not allowed: ${v.reason}`
  if (v.reasonDescription !== null) msg += ` (${v.reasonDescription})`
  return msg
}

/** Thrown by applyProfile when the profile's action is `error`. */
export class ProfileViolationError extends Error {
  constructor(public readonly violations: ProfileViolation[]) {
    super('Profile violations: ' + violations.map(formatProfileViolation).join('; '))
    this.name = 'ProfileViolationError'
  }
}

// Re-export the helper type so consumers can reference Attrs without ast import.
export type { Attrs }
export type { AnyNode, Document }

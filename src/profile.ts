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
import { ownValue } from './own-property.js'
import { SCHEME_PROBE_STRIP_RE } from './render-html.js'

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
  'admonition',
  'line_block',
  'comment',
  'figure',
  'figure_group',
  'caption',
  // PART 12 §18 gives a citation definition its own block type, and
  // `spec/docs/profiles.md` lists it alongside the other two definition kinds.
  // This engine already EMITS it (markup-carve/carve-js#1122); only the
  // nameable vocabulary was behind, and a type the vocabulary does not know
  // falls through the string-only `isTypeAllowed` as ALLOWED - the opposite of
  // what the same profile answers with an axis.
  'citation_definition',
  // A DEFINITION LINE IS CONTENT, so both definition types are deniable
  // (carve#826, the ruling on carve#771). They render nothing in HTML and are
  // real output on the `carve`, `markdown` and `plain` targets, so a profile
  // that cannot name them cannot describe those targets.
  //
  // The FILTER already did the right thing; what was wrong is the string-only
  // query. `isTypeAllowed(t)` has no axis to resolve on, so it fell back to
  // "not in the vocabulary, therefore allowed" and answered the opposite of
  // `isTypeAllowed(t, true)` for the same profile - the exact drift carve-js#712
  // fixed for five other types, with this pair left out (carve-js#753).
  'abbreviation_def',
  'link_reference_definition',
  // Listed by profiles.md's block vocabulary and missing here until carve-js#712:
  // the page publishes frontmatter as a root field (PART 12 section 2), so denying it
  // is a real decision about what leaves the engine even though the HTML is
  // unchanged. carve-rs and carve-php both name it.
  'frontmatter',
] as const

/** Canonical inline node-type vocabulary (snake_case). */
export const CANONICAL_INLINE_TYPES = [
  'text',
  'autolink',
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
  // Listed by profiles.md's inline vocabulary and missing here until carve-js#712.
  // `canonicalType`'s default arm already calls four of these "their own canonical
  // names, not absences" (carve-js#472) - so the mapper and the vocabulary
  // disagreed, and `isTypeAllowed(type)` with no axis fell through to step 3 and
  // ALLOWED a type the caller had just denied.
  'caption_number',
  'citation',
  'citation_group',
  'critic_comment',
  'heading_ref',
  'substitution',
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
/**
 * Types that are a SPECIALIZATION of a broader one.
 *
 * `profiles.md` requires both to be nameable on their own: an autolink is not a
 * `link` (folding it in loses the authored form a round trip has to restore),
 * and an admonition is not a `div` (a profile wanting to deny callouts while
 * allowing generic containers cannot say so if the kind lives in a class
 * string). Naming them used to be a silent no-op, because both folded into the
 * broader name before the check (issue 362).
 *
 * They stay COVERED BY the broader name, though: a profile that denies `link`
 * must keep stripping autolinks, and one that denies `div` must keep stripping
 * admonitions. Otherwise unfolding them would quietly widen every profile that
 * already relies on the broad name - the opposite of what a deny list is for.
 */
const SUPERTYPE: Record<string, string> = {
  autolink: 'link',
  admonition: 'div',
}

/** The type itself, plus its supertype when it has one. */
function withSupertype(type: string): string[] {
  const parent = ownValue(SUPERTYPE, type)
  return parent === undefined ? [type] : [type, parent]
}

export function canonicalType(type: string): string {
  switch (type) {
    // ----- block -----
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return 'heading'
    case 'code_block':
      return 'code_block'
    case 'block_quote':
      return 'block_quote'
    case 'list':
      return 'list'
    case 'list_item':
      return 'list_item'
    case 'table':
      return 'table'
    case 'table_row':
      return 'table_row'
    case 'table_cell':
      return 'table_cell'
    case 'thematic_break':
      return 'thematic_break'
    case 'div':
      return 'div'
    case 'admonition':
      return 'admonition'
    case 'raw_block':
      return 'raw_block'
    case 'definition_list':
      return 'definition_list'
    case 'figure':
      return 'figure'
    case 'figure_group':
      return 'figure_group'
    case 'comment':
      return 'comment'
    // ----- inline -----
    case 'text':
      return 'text'
    // Its own canonical name, NOT folded into `text`. profiles.md lists
    // `escaped_text` in the normative inline vocabulary, and ast.ts explains
    // why the type exists at all: the escape carries intent the bare character
    // does not. Folding it here made `denyInline(['escaped_text'])` a silent
    // no-op while the vocabulary said it was nameable (carve-js#474). Contrast
    // `smart_punctuation` below, which profiles.md explicitly excludes.
    case 'escaped_text':
      return 'escaped_text'
    // Smart typography is ordinary visible prose, so it shares text's trust
    // class rather than becoming a nameable type of its own (the same way the
    // inline literal folds into `code`).
    case 'smart_punctuation':
      return 'text'
    case 'emphasis':
      return 'emphasis'
    case 'strong':
      return 'strong'
    case 'underline':
      return 'underline'
    case 'strike':
      return 'strike'
    case 'inline_extension':
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
    case 'autolink':
      return 'autolink'
    case 'image':
      return 'image'
    case 'soft_break':
      return 'soft_break'
    case 'hard_break':
      return 'hard_break'
    case 'raw_inline':
      return 'raw_inline'
    case 'literal_inline':
      // An inline literal is a code span with the `<code>` wrapper dropped:
      // same verbatim capture, same escaping, same trailing-attribute surface.
      // So it is classified as `code` for profiles -- allowed exactly where a
      // code span is, denied where code is. (It shares `code`'s trust class the
      // way `inline_footnote` shares `footnote`'s.) Aliasing it to `text`
      // instead would be WRONG: with attributes it renders a `<span>`, carrying
      // class/id/style just as an attributed code span does, so it belongs with
      // `code`, not with plain text.
      return 'code'
    case 'footnote_ref':
    case 'inline_footnote':
      // Inline footnote (`^[...]`) carries `inline`; a reference (`[^id]`)
      // does not. carve-php denies both under the footnote family, so the
      // mapping does not matter for allow/deny, but we distinguish so a
      // profile could allow one and not the other.
      //
      // Each is its own canonical name. Given only a type STRING that is the
      // whole answer; `resolveCanonical` has the node and tells the two apart
      // by shape, which is the case this arm used to defer to by returning
      // undefined.
      return type
    case 'span':
      return 'span'
    case 'superscript':
      return 'superscript'
    case 'subscript':
      return 'subscript'
    case 'highlight':
      return 'highlight'
    case 'insert':
      return 'insert'
    case 'delete':
      return 'delete'
    case 'symbol':
      return 'symbol'
    case 'math':
      return 'math'
    case 'abbreviation':
      return 'abbreviation'
    default:
      // A type with no FOLD is still a type: `heading_ref`, `caption_number`,
      // `abbreviation_def`, `substitution` and `critic_comment` are their own
      // canonical names, not absences.
      //
      // This used to return undefined, and the filter read that as "deny" - so
      // a profile denying nothing deleted them (carve-js#472). The call sites
      // compensated with `?? node.type`, which worked and left a sentinel
      // whose only meaning was "ask the caller instead". Total is the honest
      // signature: every type resolves to itself unless it folds into another.
      return type
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
   * The scheme is read through `SCHEME_PROBE_STRIP_RE`, the renderer's own
   * probe class, so this rule and PART 9 §25's answer the same way about a
   * scheme split by a character a URL consumer discards. That is a NARROWING:
   * stripping only removes characters, so the deny lists can recognize more and
   * can never recognize less, and no legitimate scheme carries one (a scheme is
   * a letter followed by letters, digits, `+`, `-` and `.`).
   *
   * Prefix classification follows the URL parser's alphabet: leading/trailing
   * ASCII C0 controls and space are ignored, and `\\` is slash-equivalent for
   * special URLs. JavaScript `trim()` is deliberately not used; it strips many
   * Unicode spaces that a URL parser keeps as relative-path content.
   *
   * @param baseHost Current document's host (for external detection).
   */
  isUrlAllowed(url: string, baseHost: string | null = null): boolean {
    url = url.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
    if (url === '') return true

    // WHATWG special URLs treat a backslash as a slash. Normalize only the
    // prefix classifier's view: the authored bytes still reach scheme and
    // allowlist checks below unchanged.
    const prefixUrl = url.replace(/\\/g, '/')

    // Fragment-only URLs are always internal.
    if (url.startsWith('#')) return this.allowInternal

    // Protocol-relative URLs are absolute external URLs, not internal paths.
    if (prefixUrl.startsWith('//')) return this.isProtocolRelativeUrlAllowed(prefixUrl, baseHost)

    // Relative paths are internal.
    if (prefixUrl.startsWith('/') || prefixUrl.startsWith('./') || prefixUrl.startsWith('../')) {
      return this.allowInternal
    }

    const colonPos = url.indexOf(':')
    if (colonPos !== -1) {
      const rawScheme = url.slice(0, colonPos).toLowerCase()
      // What a URL consumer would read as the scheme: the probe class off,
      // because a consumer may discard any of those characters before it
      // decides what the scheme is. `trim()` only reaches the ends, so while
      // this was the raw text `java<DEL>script:` and `java<U+0001>script:`
      // walked past the denylist (markup-carve/carve-js#917).
      const scheme = rawScheme.replace(SCHEME_PROBE_STRIP_RE, '')

      if (this.deniedSchemes.includes(scheme)) return false
      // The ALLOW lookup deliberately reads the RAW text, not the probe.
      //
      // The two lists ask opposite questions. Deny asks "could a consumer read
      // this as a scheme I refuse", so it has to see through the split. Allow
      // asks "is this exactly a scheme I permit", and a scheme carrying a
      // control character is not one - an allowlist refuses what it does not
      // recognize, which is why this form was never defeated. Reading the
      // probe here would START allowing `htt<DEL>ps:` under
      // `setAllowedSchemes(['https'])`, turning a fix into a widening.
      if (this.allowedSchemes !== null && !this.allowedSchemes.includes(rawScheme)) return false

      // mailto: and tel: are considered internal for simplicity.
      if (scheme === 'mailto' || scheme === 'tel') return true

      if (scheme === 'http' || scheme === 'https') {
        // parseHost needs a scheme its own pattern accepts, or a split one
        // returns null and skips the domain denylist and the allowExternal
        // check with it. Only the scheme is repaired; the authority reaches
        // parseHost with its original bytes, so no character outside the
        // scheme changes which host is read.
        const host = parseHost(scheme + url.slice(colonPos))
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
  getReasonDisallowed(canonical: string, isBlock?: boolean): string | null {
    if (this.isTypeAllowed(canonical, isBlock)) return null
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

  /**
   * Whether a canonical type string is allowed by this profile.
   *
   * `isBlock` is the node's OWN axis, and is what makes a type outside the
   * vocabulary resolvable: block-vs-inline cannot be read off a type string the
   * vocabulary does not know, and it is unambiguous at the node.
   *
   * profiles.md "Resolution" makes the three steps exhaustive and forbids a
   * fourth that denies unrecognized types. This used to have that fourth step,
   * and it meant a construct whose type predated the vocabulary rendered as
   * NOTHING - not degraded to text, gone - under any profile at all, including
   * one that denies nothing. `{~old~>new~}` lost both the old wording and the
   * new (carve#419).
   *
   * An allow list still excludes an unknown type, so a restrictive profile
   * loses no safety: step 2 handles it by construction.
   */
  isTypeAllowed(canonical: string, isBlock?: boolean): boolean {
    if (canonical === 'document') return true
    if (INLINE_SET.has(canonical)) return this.isInlineAllowed(canonical)
    if (BLOCK_SET.has(canonical)) return this.isBlockAllowed(canonical)
    // Outside the vocabulary: resolve on the node's own axis, unchanged.
    if (isBlock !== undefined) {
      return isBlock ? this.isBlockAllowed(canonical) : this.isInlineAllowed(canonical)
    }

    // Called without an axis (the string-only API, not the filter). Step 2
    // would exclude the type on whichever axis it belongs to, so an allow list
    // on either axis means denied; with neither set, step 3 allows it. Fails
    // CLOSED, because the caller cannot say which axis it meant.
    return this.allowedInline === null && this.allowedBlock === null
  }

  private isInlineAllowed(type: string): boolean {
    const names = withSupertype(type)
    if (names.some((n) => this.deniedInline.includes(n))) return false
    if (this.allowedInline !== null) return names.some((n) => this.allowedInline!.includes(n))
    return true
  }

  private isBlockAllowed(type: string): boolean {
    const names = withSupertype(type)
    if (names.some((n) => this.deniedBlock.includes(n))) return false
    if (this.allowedBlock !== null) return names.some((n) => this.allowedBlock!.includes(n))
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

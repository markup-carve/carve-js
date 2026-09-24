/**
 * The versioned AST interchange envelope (PART 12 §34, [CARVE-P12-056]).
 *
 * The tree is strict-closed and carries no version, so a reader that cannot
 * read a payload has one answer for three different problems: a corrupt tree, a
 * vocabulary this build does not know, and a document needing an extension it
 * does not implement all arrive as one validation error. The envelope is what
 * lets the reader name which one it hit.
 *
 * The tree does not move. `document` is exactly what `toAstJson` writes and
 * `fromAstJson` reads, `carve --json` still writes it bare, and an in-memory
 * handoff still passes it bare. This module is the storage-and-process-boundary
 * surface added beside that, not a change to it.
 */

import {
  fromAstJson,
  toAstJson,
  type AstJsonDocument,
} from './ast-json.js'
import type { Document } from './ast.js'
import { hasOwnKey, ownValue } from './own-property.js'

/**
 * The interchange contract version this build implements.
 *
 * NOT the Carve language version, and it does not track it: the language is
 * versioned for authors, this is versioned for readers of a tree. A major bump
 * removes, renames or reinterprets a field or a meaning; a minor bump adds a
 * field or a node type.
 */
export const AST_CONTRACT_VERSION = '1.0'

/** The vocabulary an envelope with no `vocabulary` is written in. */
export const CORE_AST_VOCABULARY = 'https://markup-carve.org/ast/core'

/**
 * `^[1-9][0-9]*\.(0|[1-9][0-9]*)$`, from `ast-envelope-schema.json`.
 *
 * A leading zero is refused, so the `0.x`-reads-as-major convention the rest of
 * this org versions by never applies to the contract version.
 */
const RE_AST_VERSION = /^[1-9][0-9]*\.(?:0|[1-9][0-9]*)$/

const ENVELOPE_FIELDS = ['astVersion', 'vocabulary', 'extensions', 'document'] as const
const EXTENSION_FIELDS = ['id', 'version', 'required'] as const

/** An extension whose node types or fields the enveloped document uses. */
export interface AstEnvelopeExtension {
  /** Globally qualified, so two extensions cannot collide. */
  id: string
  /** The extension's own version, opaque to the envelope. */
  version?: string
  /**
   * Whether the document's MEANING depends on it. Absent means true: a reader
   * that drops a required extension has rendered a different document.
   */
  required?: boolean
}

/** A Carve AST at a storage or process boundary. */
export interface AstEnvelope {
  astVersion: string
  vocabulary?: string
  extensions?: AstEnvelopeExtension[]
  document: AstJsonDocument
}

export interface ToAstEnvelopeOptions {
  /** Omitted means the core vocabulary, which is the canonical spelling. */
  vocabulary?: string
  extensions?: readonly AstEnvelopeExtension[]
}

export interface FromAstEnvelopeOptions {
  /** Extension ids this reader implements. Anything else marked required is refused. */
  extensions?: readonly string[]
  /** Vocabularies this reader understands, beside the core one. */
  vocabularies?: readonly string[]
  /** Passed through to `fromAstJson` for the §9 ingest budgets. */
  payloadByteLength?: number
}

/**
 * Thrown when the envelope itself is not the shape the schema names.
 *
 * Separate from every error `fromAstJson` raises, which are about the tree
 * INSIDE it: the whole point of §34 is that a reader can say which of the two
 * it is looking at.
 */
export class AstEnvelopeShapeError extends Error {
  constructor(readonly detail: string) {
    super(`AST envelope is not the shape PART 12 §34 names: ${detail}`)
    this.name = 'AstEnvelopeShapeError'
  }
}

/**
 * Thrown when the payload announces a higher MAJOR contract version.
 *
 * §34(a) asks for a typed error naming both versions, and says why it is not a
 * schema failure: the payload may be perfectly well-formed under a contract
 * this build predates. Reporting it as a validation error sends the caller
 * looking for a corrupt tree.
 */
export class AstEnvelopeVersionError extends Error {
  constructor(
    readonly found: string,
    readonly implemented: string = AST_CONTRACT_VERSION,
  ) {
    super(
      `AST envelope announces contract version ${found}; this build implements ` +
        `${implemented}. A higher major removes, renames or reinterprets, so the ` +
        'payload is refused rather than half-read (PART 12 §34(a))',
    )
    this.name = 'AstEnvelopeVersionError'
  }
}

/**
 * Thrown when the payload marks an extension required that this reader does not
 * implement.
 *
 * §34(c). Rendering the parts it understands and reporting success is what
 * §9(b) forbids one level down, for the same reason.
 */
export class AstEnvelopeExtensionError extends Error {
  constructor(readonly extension: string) {
    super(
      `AST envelope requires extension ${JSON.stringify(extension)}, which this ` +
        'reader does not implement (PART 12 §34(c))',
    )
    this.name = 'AstEnvelopeExtensionError'
  }
}

/**
 * Thrown when the payload names a vocabulary this build does not know.
 *
 * §34 names "a vocabulary this build does not know" as one of the three
 * failures the envelope exists to tell apart, and §34(d) fixes what an ABSENT
 * one means. It does not spell out the action for a foreign one, and this is
 * the reading that makes the field do the work the clause claims for it: a tree
 * in another vocabulary would otherwise reach `fromAstJson` and come back as an
 * unknown node type, which is the undifferentiated failure §34 opens by naming.
 */
export class AstEnvelopeVocabularyError extends Error {
  constructor(readonly vocabulary: string) {
    super(
      `AST envelope is written in vocabulary ${JSON.stringify(vocabulary)}, which ` +
        'this reader does not know (PART 12 §34)',
    )
    this.name = 'AstEnvelopeVocabularyError'
  }
}

/**
 * Wraps a document for a storage or process boundary.
 *
 * The version emitted is always this build's own. §34: "A PRODUCER EMITS ONE
 * CANONICAL VERSION - the contract its build implements - rather than echoing
 * what it read", because re-emitting an ingested `astVersion` republishes a
 * claim the producer cannot keep. There is deliberately no option to override
 * it.
 */
export function toAstEnvelope(doc: Document, options: ToAstEnvelopeOptions = {}): AstEnvelope {
  const envelope: AstEnvelope = {
    astVersion: AST_CONTRACT_VERSION,
    document: toAstJson(doc),
  }
  if (options.vocabulary !== undefined) envelope.vocabulary = options.vocabulary
  if (options.extensions?.length) {
    envelope.extensions = options.extensions.map((extension) => ({ ...extension }))
  }
  return envelope
}

function readEnvelopeExtensions(value: unknown): AstEnvelopeExtension[] {
  if (!Array.isArray(value)) throw new AstEnvelopeShapeError('"extensions" is not an array')
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new AstEnvelopeShapeError(`extension ${index} is not an object`)
    }
    const record = entry as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (!(EXTENSION_FIELDS as readonly string[]).includes(key)) {
        throw new AstEnvelopeShapeError(
          `extension ${index} carries ${JSON.stringify(key)}, which the schema does not name`,
        )
      }
    }
    const id = ownValue(record, 'id')
    if (typeof id !== 'string') throw new AstEnvelopeShapeError(`extension ${index} has no "id"`)
    const extension: AstEnvelopeExtension = { id }
    const version = ownValue(record, 'version')
    if (version !== undefined) {
      if (typeof version !== 'string') {
        throw new AstEnvelopeShapeError(`extension ${JSON.stringify(id)} has a non-string "version"`)
      }
      extension.version = version
    }
    const required = ownValue(record, 'required')
    if (required !== undefined) {
      if (typeof required !== 'boolean') {
        throw new AstEnvelopeShapeError(
          `extension ${JSON.stringify(id)} has a non-boolean "required"`,
        )
      }
      extension.required = required
    }
    return extension
  })
}

/**
 * Reads an envelope and returns the document inside it.
 *
 * The checks run widest-first, so the caller hears about the contract before
 * the tree: a payload from a newer major is refused whatever its tree looks
 * like, and a tree is only walked once the reader has agreed it can read this
 * contract, this vocabulary and these extensions at all.
 */
export function fromAstEnvelope(
  envelope: AstEnvelope,
  options: FromAstEnvelopeOptions = {},
): Document {
  if (typeof envelope === 'string') {
    throw new TypeError(
      'fromAstEnvelope takes a parsed envelope object, not a JSON string; call JSON.parse first',
    )
  }
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new AstEnvelopeShapeError('the envelope is not an object')
  }
  const record = envelope as unknown as Record<string, unknown>
  // `additionalProperties: false` holds on the envelope as well as on every
  // node inside it: §34 closes it for the reason §11 closed the tree.
  for (const key of Object.keys(record)) {
    if (!(ENVELOPE_FIELDS as readonly string[]).includes(key)) {
      throw new AstEnvelopeShapeError(
        `it carries ${JSON.stringify(key)}, which the schema does not name`,
      )
    }
  }

  const astVersion = ownValue(record, 'astVersion')
  if (typeof astVersion !== 'string') throw new AstEnvelopeShapeError('"astVersion" is missing')
  if (!RE_AST_VERSION.test(astVersion)) {
    throw new AstEnvelopeShapeError(
      `"astVersion" is ${JSON.stringify(astVersion)}, which is not major.minor with no leading zero`,
    )
  }
  if (!hasOwnKey(record, 'document')) throw new AstEnvelopeShapeError('"document" is missing')

  const [major] = astVersion.split('.') as [string, string]
  const [ourMajor] = AST_CONTRACT_VERSION.split('.') as [string, string]
  // A higher major only. A LOWER one cannot arrive while this build implements
  // major 1, which the schema's pattern makes the lowest there is, so there is
  // nothing to decide and no rule invented for it.
  if (Number(major) > Number(ourMajor)) throw new AstEnvelopeVersionError(astVersion)

  const vocabulary = ownValue(record, 'vocabulary')
  if (vocabulary !== undefined) {
    if (typeof vocabulary !== 'string') {
      throw new AstEnvelopeShapeError('"vocabulary" is not a string')
    }
    const known = [CORE_AST_VOCABULARY, ...(options.vocabularies ?? [])]
    if (!known.includes(vocabulary)) throw new AstEnvelopeVocabularyError(vocabulary)
  }

  const extensions = ownValue(record, 'extensions')
  if (extensions !== undefined) {
    const implemented = options.extensions ?? []
    for (const extension of readEnvelopeExtensions(extensions)) {
      // Absent means true. An extension a reader may ignore without misreading
      // the document has to say so.
      if (extension.required === false) continue
      if (!implemented.includes(extension.id)) throw new AstEnvelopeExtensionError(extension.id)
    }
  }

  // A higher MINOR needs no gate of its own: §34(b) makes it acceptable exactly
  // where every required extension is implemented, and the loop above is that
  // condition. A minor adds, so the tree is readable except for what the
  // additions carry, and `required` is the payload's own statement of whether
  // those additions are load-bearing.
  return fromAstJson(ownValue(record, 'document') as AstJsonDocument, options.payloadByteLength)
}

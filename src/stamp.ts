/**
 * Provenance stamping for `carve fmt --stamp`.
 *
 * Writes a tool-authored marker at the end of a document recording the spec
 * version it was processed under and the engine that wrote it. The marker is a
 * plain Carve comment, so it renders nothing and survives a plain `carve fmt`.
 * It is deterministic (no timestamp) and replace-in-place, so re-stamping is
 * idempotent and never accumulates markers.
 *
 * Two forms:
 *   line:  `%% carve-version: 0.1; generated-by: carve-js 0.1.0`
 *   block: `%%%\ncarve-version: 0.1\ngenerated-by: carve-js 0.1.0\n%%%`
 *
 * Writing the marker is only half of it: the spec's upgrade procedure says to
 * review the `[behavior]` changelog entries between a document's stamped version
 * and the target, which needs the marker read back - `readStamp` / `needsReview`.
 */
import { SPEC_VERSION } from './version.js'

export type StampForm = 'line' | 'block'

/** Build the marker text (no surrounding blank lines / trailing newline). */
export function buildMarker(generatedBy: string, form: StampForm): string {
  if (form === 'block') {
    return `%%%\ncarve-version: ${SPEC_VERSION}\ngenerated-by: ${generatedBy}\n%%%`
  }
  return `%% carve-version: ${SPEC_VERSION}; generated-by: ${generatedBy}`
}

/**
 * Remove a trailing provenance marker (either form) from already-formatted
 * Carve, returning the body with no trailing blank lines. Recognizes the marker
 * by its `carve-version:` first field, so unrelated trailing comments are kept.
 */
export function stripTrailingMarker(formatted: string): string {
  const lines = formatted.replace(/\n+$/, '').split('\n')
  if (lines.length === 0) return ''

  const last = lines[lines.length - 1]!
  if (/^%%[ \t]*carve-version:/.test(last)) {
    lines.pop()
  } else if (/^%{3,}[ \t]*$/.test(last)) {
    // Block form: scan up for the matching opener fence whose first content
    // line is `carve-version:`.
    const fence = last.trim()
    for (let i = lines.length - 2; i >= 0; i--) {
      if (lines[i]!.trim() !== fence) continue
      if (/^carve-version:/.test((lines[i + 1] ?? '').trim())) {
        lines.splice(i, lines.length - i)
      }
      break
    }
  }

  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/**
 * Append (or replace) the provenance marker on already-formatted Carve.
 * `generatedBy` is the engine identity, e.g. `carve-js 0.1.0`.
 */
export function stampCarve(formatted: string, generatedBy: string, form: StampForm = 'line'): string {
  const body = stripTrailingMarker(formatted)
  const marker = buildMarker(generatedBy, form)
  if (body === '') return marker + '\n'
  return body.replace(/\n$/, '') + '\n\n' + marker + '\n'
}

/** A document's provenance, as recorded by the marker. */
export interface Stamp {
  /** The spec version the document was last processed under. */
  version: string
  /** The engine that wrote the marker, when it recorded one. */
  generatedBy: string | null
}

/**
 * Read a document's provenance marker, or null when it carries none.
 *
 * Recognizes both documented forms and identifies the marker by
 * `carve-version:` as its first field, so an ordinary trailing comment is not
 * mistaken for provenance. A missing `generated-by` is tolerated.
 *
 * Null is the normal answer for hand-written documents: nothing has stamped them
 * yet.
 */
export function readStamp(source: string): Stamp | null {
  const lines = source.replace(/\n+$/, '').split('\n')
  if (lines.length === 0) return null

  const last = (lines[lines.length - 1] ?? '').trim()

  const lineForm = /^%%[ \t]*carve-version:[ \t]*([^;\s]+)(?:[ \t]*;[ \t]*generated-by:[ \t]*(.+))?$/.exec(last)
  if (lineForm) {
    const generatedBy = (lineForm[2] ?? '').trim()
    return { version: lineForm[1]!, generatedBy: generatedBy === '' ? null : generatedBy }
  }

  // Block form: the closing fence is last, the fields sit above it.
  if (!/^%{3,}$/.test(last)) return null

  let version: string | null = null
  let generatedBy: string | null = null
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = (lines[i] ?? '').trim()
    if (/^%{3,}$/.test(line)) break

    const versionField = /^carve-version:[ \t]*(.+)$/.exec(line)
    if (versionField) {
      version = versionField[1]!.trim()
      continue
    }
    const byField = /^generated-by:[ \t]*(.+)$/.exec(line)
    if (byField) generatedBy = byField[1]!.trim()
  }

  return version === null ? null : { version, generatedBy }
}

/**
 * Whether a document was last processed under an older spec version than this
 * implementation targets, so its `[behavior]` changelog entries are worth
 * reviewing.
 *
 * An unstamped document answers true: its provenance is unknown, and assuming it
 * is current is the unsafe direction. A document stamped with a FUTURE version
 * answers false - this engine has nothing to say about changes it does not know.
 */
export function needsReview(source: string, currentVersion: string = SPEC_VERSION): boolean {
  const stamp = readStamp(source)
  if (stamp === null) return true

  return compareVersions(stamp.version, currentVersion) < 0
}

/** Numeric-segment comparison; a non-numeric segment compares as 0. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)

  for (let i = 0; i < length; i++) {
    const l = Number.parseInt(left[i] ?? '0', 10) || 0
    const r = Number.parseInt(right[i] ?? '0', 10) || 0
    if (l !== r) return l < r ? -1 : 1
  }

  return 0
}

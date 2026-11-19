/**
 * Reading a plain object with a key the DOCUMENT chose.
 *
 * Every lookup table in this engine that is keyed by author text - the footnote
 * definition map, the AST-JSON wire schema tables, an extension's renderer
 * record, the `symbols` option, the SVG sanitizer's entity table - is a plain
 * object literal, so it inherits from `Object.prototype`. A document that names
 * a key living there gets a hit on a table it was never in:
 *
 *   defs['__proto__']      -> Object.prototype   (truthy, and not iterable)
 *   WIRE_FIELDS['toString'] -> a function        (truthy, and not iterable)
 *   renderers['valueOf']    -> a function        (truthy, and called)
 *
 * The symptom depends only on what the caller does next. `[^__proto__]` - twelve
 * bytes on the default `carveToHtml` path - passed the "is there a definition"
 * guard and then threw an uncaught TypeError out of the `for...of` over the
 * supposed body; `carve lint` dropped its unresolved-footnote diagnostic because
 * the same read said a definition was there; the AST-JSON reader judged an
 * incoming definition labelled `toString` a duplicate and silently discarded it
 * (markup-carve/carve-js#886).
 *
 * `Object.hasOwn` is the whole answer, and `src/lint.ts` already reached for it
 * on the one table that got the treatment. These wrap it so the intent reads at
 * the call site and so the guard cannot be dropped by a later edit that keeps
 * the index expression.
 *
 * The SIBLING ENGINES have no such class: carve-php keys these with PHP arrays
 * and carve-rs with `HashMap`, neither of which has a prototype chain to walk
 * into. This is the JavaScript object model showing through, so it has to be
 * handled at every read rather than fixed once in a data structure - a
 * null-prototype table would help only until the next `{ ...table }`, which
 * hands back an ordinary object.
 */

/**
 * `record[key]`, but only when `key` is the record's OWN property.
 *
 * Returns `undefined` for anything reached through the prototype chain, which is
 * what "the table does not have this key" already meant everywhere this is used.
 */
export function ownValue<T>(
  record: Readonly<Record<string, T>> | undefined | null,
  key: string,
): T | undefined {
  if (record === undefined || record === null) return undefined

  return Object.hasOwn(record, key) ? record[key] : undefined
}

/**
 * `key in record`, but only for the record's OWN keys.
 *
 * `in` walks the prototype chain, so `'toString' in defs` is true for every
 * plain object. Where the question is "did the document define this", it is not.
 */
export function hasOwnKey(
  record: Readonly<Record<string, unknown>> | undefined | null,
  key: string,
): boolean {
  return record !== undefined && record !== null && Object.hasOwn(record, key)
}

/**
 * Write `record[key] = value` as an OWN data property.
 *
 * Plain assignment is not enough: `record['__proto__'] = body` runs the
 * prototype setter instead of creating a property, so the definition is not
 * stored and the record's prototype is replaced with the body. Every later read
 * then answers from that body. `defineProperty` stores what was meant.
 */
export function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

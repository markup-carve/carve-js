/**
 * Version metadata for carve-js.
 *
 * `SPEC_VERSION` is the Carve spec version this implementation conforms to
 * (the `Version:` field in the spec grammar). `LIB_VERSION` is this package's
 * own release (the-lib-version-constant-tracks-the-package-version.test.ts
 * pins it to package.json, so a release bump cannot miss it). Both feed the
 * provenance stamp written by `carve fmt --stamp`.
 */
export const SPEC_VERSION = '0.1'
export const LIB_VERSION = '0.1.4'

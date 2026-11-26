// The limits a conformance case lowers through `host.limits` (spec/0.2/conformance/README.md). Test-only: they are
// no Carve option, and a host may raise no limit (C2-H-201).

/** The lowered limits of the conformance harness (conformance/README.md, `host.limits`); never a Carve option. */
export interface SnippetLimits {
  snippetDepth?: number
  snippetNodes?: number
  derivedTextBytes?: number
}

let testLimits: SnippetLimits | null = null

/** Runs `run` with the harness limits of one case. Test-only: a host may raise no limit (C2-H-201). */
export function withSnippetLimits<T>(limits: SnippetLimits | undefined, run: () => T): T {
  const before = testLimits
  testLimits = limits ?? null
  try {
    return run()
  } finally {
    testLimits = before
  }
}

/** The lowered limits of the running case, or null. */
export function harnessLimits(): SnippetLimits | null {
  return testLimits
}

/** The derived-text budget a harness case replaces, or undefined. */
export function testDerivedTextBytes(): number | undefined {
  return testLimits?.derivedTextBytes
}


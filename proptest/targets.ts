export type Target = 'parse' | 'render' | 'format' | 'diagnostics' | 'extensions' | 'decode' |
  'cli' | 'lint' | 'migrate' | 'import'

export const TARGETS: readonly Target[] = [
  'parse', 'render', 'format', 'diagnostics', 'extensions', 'decode', 'cli', 'lint', 'migrate', 'import',
]

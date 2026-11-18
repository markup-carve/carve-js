import config from '../../eslint.config.mjs'

export default [...config, {
  files: ['v2/extensions/**/*.ts', 'v2/test/extension-migration/**/*.ts'],
  languageOptions: { parserOptions: { project: ['./v2/extensions/tsconfig.json'] } },
}]

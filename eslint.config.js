import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  { ignores: ['node_modules/**', 'public/**', 'artifacts/**', '.agents/**', '.claude/**', '.codex/**', 'reference/**', 'scripts/**', 'test/**', 'server.mjs', 'eslint.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }, plugins: { 'react-hooks': hooks }, rules: { '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }], '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/ban-ts-comment': 'error', 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error', 'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }] } }
);

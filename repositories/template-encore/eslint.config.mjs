import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      'artifacts/**', // business input artifacts used by AI skills in consuming projects — not lintable source
      '**/*.min.js',
      '**/*.min.css',
      '**/build/**', // built SPA bundle (served by the web service; emitted by build:web)
      'apps/api/.encore/**', // Encore local build cache
      'apps/api/encore.gen/**', // Encore-generated client/runtime code
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended + type-checked rules
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // TypeScript file settings
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 30,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // Vue files
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.vue'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      // Disable unsafe-* type-checked rules for Vue SFCs — projectService
      // cannot fully resolve Vue compiler-generated types, causing false positives.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },

  // Prettier — must come AFTER Vue plugin rules so it wins over Vue formatting rules
  // (vue/max-attributes-per-line, vue/singleline-html-element-content-newline, etc.)
  eslintConfigPrettier,

  // Test files - disable type-checked rules (test files are excluded from tsconfig projects)
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },

  // CLI scripts (.ts) — allow console.log, relax type-checked rules for JSON parsing
  {
    files: ['apps/api/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },

  // Plain JS/MJS/CJS files — no TypeScript type information available.
  // recommendedTypeChecked rules (e.g. await-thenable) require projectService,
  // which is only configured for .ts and .vue files.  Without this override,
  // ESLint errors with "requires type information" on CI (Linux) even though
  // the rule cannot meaningfully apply to plain JS files.
  // Node globals declared for apps/api/scripts/ which run in Node.js.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // apps/api is a standalone Encore.ts app; relax type-checked rules that clash
  // with documented Encore idioms and with external-library `any` boundaries.
  // Test files are excluded here so they keep disableTypeChecked from the test
  // block above (they are not part of a tsconfig project).
  {
    files: ['apps/api/**/*.ts'],
    ignores: ['apps/api/**/*.test.ts'],
    rules: {
      // api.raw / endpoint handlers are async by design; Encore awaits them at
      // runtime even though the RawHandler type is nominally void-returning.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      // Handlers are declared async for a uniform signature even when a given
      // one happens not to await (Encore convention).
      '@typescript-eslint/require-await': 'off',
      // getAuthData()! is the documented accessor for the authenticated
      // principal inside an auth:true endpoint (see CODEMAP).
      '@typescript-eslint/no-non-null-assertion': 'off',
      // openid-client v6 token claims and Node http header values surface `any`
      // at their type boundaries; the no-unsafe-* family
      // produces false positives there, exactly as for Vue SFCs above. Boundary
      // values are narrowed explicitly in code before use.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
);

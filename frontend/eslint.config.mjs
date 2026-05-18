// eslint.config.mjs - Frontend specific configuration
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '*.config.js',
      '*.config.mjs',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,
  ...pluginVue.configs['flat/recommended'],
  eslintConfigPrettier,

  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      eqeqeq: ['error', 'always'],
      'prettier/prettier': ['warn', { usePrettierrc: true }],
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'vue/block-order': [
        'error',
        {
          order: ['script', 'template', 'style[scoped]', 'style:not([scoped])'],
        },
      ],
      'vue/no-v-html': 'error',
      'vue/attribute-hyphenation': ['error', 'always'],
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/custom-event-name-casing': ['error', 'kebab-case'],
      'vue/define-emits-declaration': 'error',
      'vue/define-macros-order': [
        'error',
        {
          order: ['defineProps', 'defineEmits', 'defineOptions', 'defineSlots'],
          defineExposeLast: true,
        },
      ],
      'vue/no-child-content': 'error',
      'vue/no-duplicate-attributes': 'error',
      'vue/no-empty-component-block': 'error',
      'vue/no-multi-spaces': 'error',
      'vue/no-reserved-component-names': 'error',
      'vue/no-static-inline-styles': ['warn', { allowBinding: false }],
      'vue/no-unused-components': 'warn',
      'vue/no-unused-vars': 'warn',
      'vue/no-use-v-if-with-v-for': 'error',
      'vue/prefer-separate-static-class': 'warn',
      'vue/require-component-is': 'error',
      'vue/require-prop-types': 'error',
      'vue/require-v-for-key': 'error',
      'vue/valid-define-emits': 'error',
      'vue/valid-define-props': 'error',
      'vue/attributes-order': 'warn',
      'vue/multi-word-component-names': 'off',
      'vue/no-multiple-template-root': 'off',
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-self-closing': 'off',
      'prettier/prettier': ['warn', { usePrettierrc: true }],
    },
  }
);

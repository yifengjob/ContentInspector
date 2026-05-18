// eslint.config.mjs
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  // 1. 全局忽略目录
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/release/**',
      '**/.github/**',
      '**/docs/**',
      '*.config.js',
      '*.config.mjs',
      'scripts/**/*.js',
    ],
  },

  // 2. ESLint 内置推荐规则
  eslint.configs.recommended,

  // 3. TypeScript 推荐规则
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  // 4. Vue 基础配置
  ...pluginVue.configs['flat/recommended'],

  // 5. 关闭与 Prettier 冲突的规则
  eslintConfigPrettier,

  // 6. JavaScript/TypeScript 文件配置
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      // 基础规则
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': 'off',
      
      // TypeScript 规则
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // 强制使用 === 和 !==
      eqeqeq: ['error', 'always'],

      // Prettier 规则
      'prettier/prettier': ['warn', { usePrettierrc: true }],
    },
  },

  // 7. Vue 文件特定配置
  {
    files: ['**/*.vue'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
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
      // TypeScript 规则
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // Vue 特定规则 - Priority A: Essential
      'vue/block-order': [
        'error',
        {
          order: ['script', 'template', 'style[scoped]', 'style:not([scoped])'],
        },
      ],
      'vue/no-v-html': [
        'error',
        {
          ignorePattern: 'TrustedHtml$',
        },
      ],

      // Priority B: Strongly Recommended
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

      // Priority C: Recommended
      'vue/attributes-order': 'warn',
      'vue/multi-word-component-names': 'off', // Electron 应用允许单名组件
      'vue/no-multiple-template-root': 'off', // Vue 3 支持多根

      // 布局规则 - 由 Prettier 管理
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-self-closing': 'off',

      // Prettier 规则
      'prettier/prettier': ['warn', { usePrettierrc: true }],
    },
  },

  // 8. 测试文件环境覆盖
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);

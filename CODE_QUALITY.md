# 代码质量管理指南

本文档介绍 ContentInspector 项目的代码质量工具和最佳实践。

## 📋 目录

- [工具栈](#工具栈)
- [快速开始](#快速开始)
- [IDE 配置](#ide-配置)
- [常用命令](#常用命令)
- [规则说明](#规则说明)
- [常见问题](#常见问题)

---

## 🛠️ 工具栈

本项目使用以下工具保证代码质量：

1. **ESLint** - JavaScript/TypeScript 代码检查
2. **Prettier** - 代码格式化工具
3. **EditorConfig** - 编辑器统一配置
4. **TypeScript** - 类型检查和严格模式

### 已安装的插件

- `@eslint/js` - ESLint 官方推荐规则
- `typescript-eslint` - TypeScript 支持
- `eslint-plugin-vue` - Vue 3 最佳实践
- `eslint-plugin-prettier` - Prettier 集成
- `eslint-config-prettier` - 关闭冲突规则
- `globals` - 全局变量定义

---

## 🚀 快速开始

### 1. 安装依赖（已完成）

```bash
pnpm install
```

### 2. 运行代码检查

```bash
# 检查所有文件
pnpm lint

# 自动修复问题
pnpm lint:fix

# 仅检查前端代码
pnpm lint:frontend
```

### 3. 格式化代码

```bash
# 格式化所有文件
pnpm format

# 检查格式（不修改）
pnpm format:check
```

---

## 💻 IDE 配置

### VSCode 推荐配置

1. **安装扩展**
   - ESLint (dbaeumer.vscode-eslint)
   - Prettier - Code formatter (esbenp.prettier-vscode)
   - EditorConfig for VS Code (EditorConfig.EditorConfig)

2. **工作区设置** (.vscode/settings.json)

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "vue"
  ],
  "[vue]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

3. **创建 .vscode/settings.json**

项目根目录已包含推荐的 VSCode 配置。

---

## 📝 常用命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `pnpm lint` | 检查所有代码 | `pnpm lint` |
| `pnpm lint:fix` | 自动修复问题 | `pnpm lint:fix` |
| `pnpm lint:frontend` | 检查前端代码 | `pnpm lint:frontend` |
| `pnpm format` | 格式化所有文件 | `pnpm format` |
| `pnpm format:check` | 检查格式 | `pnpm format:check` |

---

## 📏 规则说明

### ESLint 核心规则

#### TypeScript 规则

```javascript
// 未使用变量（允许 _ 前缀）
'@typescript-eslint/no-unused-vars': ['warn', {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_'
}]

// any 类型警告
'@typescript-eslint/no-explicit-any': 'warn'

// 强制 === 
eqeqeq: ['error', 'always']
```

#### Vue 规则

```javascript
// 组件块顺序：script > template > style
'vue/block-order': ['error', {
  order: ['script', 'template', 'style[scoped]', 'style:not([scoped])']
}]

// define 宏顺序
'vue/define-macros-order': ['error', {
  order: ['defineProps', 'defineEmits', 'defineOptions', 'defineSlots'],
  defineExposeLast: true
}]

// Props 必须有类型
'vue/require-prop-types': 'error'

// v-for 必须有 key
'vue/require-v-for-key': 'error'
```

### Prettier 规则

```json
{
  "semi": true,              // 使用分号
  "singleQuote": true,       // 单引号
  "tabWidth": 2,             // 2空格缩进
  "trailingComma": "es5",    // ES5 兼容的尾逗号
  "printWidth": 100,         // 每行100字符
  "arrowParens": "always"    // 箭头函数参数始终加括号
}
```

---

## ❓ 常见问题

### Q1: 如何忽略某个文件的检查？

在文件顶部添加注释：

```javascript
/* eslint-disable */
// 整个文件禁用 ESLint
```

或针对特定规则：

```javascript
/* eslint-disable no-console */
console.log('debug');
/* eslint-enable no-console */
```

### Q2: 如何处理未使用变量的警告？

如果变量确实不需要使用，使用 `_` 前缀：

```typescript
// ✅ 正确
function handleClick(_event: MouseEvent) {
  // ...
}

const [_count, setCount] = useState(0);
```

### Q3: 为什么有些规则是 warn 而不是 error？

- **warn**: 不会阻止构建，但会在控制台显示警告
- **error**: 会阻止构建，必须修复

对于新项目，建议逐步从 warn 过渡到 error。

### Q4: 如何临时禁用某行检查？

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = fetchData();
```

### Q5: Git 提交时会自动检查吗？

目前需要手动运行 `pnpm lint:fix`。后续可以配置 Git Hooks (husky + lint-staged) 实现自动化。

---

## 🎯 最佳实践

### 1. 开发流程

```bash
# 1. 编写代码
# 2. 保存时自动格式化（IDE 配置）
# 3. 提交前运行检查
pnpm lint:fix
pnpm format

# 4. 确认无错误后提交
git add .
git commit -m "feat: xxx"
```

### 2. 团队协作

- 确保所有成员使用相同的 IDE 配置
- 定期运行 `pnpm lint` 检查代码质量
- Code Review 时关注 ESLint 警告
- 不要随意禁用规则，除非有充分理由

### 3. 新增规则

如需添加新规则，编辑 `eslint.config.mjs`：

```javascript
{
  rules: {
    'new-rule': 'error'
  }
}
```

---

## 📚 参考资料

- [ESLint 官方文档](https://eslint.org/)
- [TypeScript ESLint](https://typescript-eslint.io/)
- [eslint-plugin-vue](https://eslint.vuejs.org/)
- [Prettier 官方文档](https://prettier.io/)

---

## 🔄 更新日志

### 2026-05-15
- ✅ 引入 ESLint + Prettier 代码质量管理体系
- ✅ 配置 TypeScript 和 Vue 3 规则
- ✅ 添加自动化检查和格式化脚本
- ✅ 创建本文档

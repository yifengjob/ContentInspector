#!/usr/bin/env node

/**
 * 版本管理脚本
 * 用法: node scripts/update-version.js <new-version>
 * 例如: node scripts/update-version.js 0.2.0
 */

const fs = require('fs');
const path = require('path');

// 获取新版本号
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('❌ 请提供新版本号');
  console.log('用法: node scripts/update-version.js <new-version>');
  console.log('例如: node scripts/update-version.js 0.2.0');
  process.exit(1);
}

// 验证版本号格式
const versionRegex = /^\d+\.\d+\.\d+$/;
if (!versionRegex.test(newVersion)) {
  console.error('❌ 版本号格式不正确，应为: x.y.z (例如: 0.2.0)');
  process.exit(1);
}

console.log(`📦 开始更新版本到: ${newVersion}\n`);

// 需要更新的文件列表
const filesToUpdate = [
  {
    path: path.join(__dirname, '..', 'package.json'),
    name: '根 package.json'
  },
  {
    path: path.join(__dirname, '..', 'frontend', 'package.json'),
    name: '前端 package.json'
  },
  {
    path: path.join(__dirname, '..', 'frontend', 'src', 'components', 'AboutModal.vue'),
    name: '关于页面 AboutModal.vue',
    isVue: true
  }
];

let successCount = 0;
let failCount = 0;

filesToUpdate.forEach(file => {
  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    let newContent;

    if (file.isToml) {
      // 处理 TOML 文件
      newContent = content.replace(
        /^version\s*=\s*".*?"/m,
        `version = "${newVersion}"`
      );
    } else if (file.isVue) {
      // 处理 Vue 文件中的版本号
      // 支持多种格式：
      // - ContentInspector v1.0.13
      // - 版本 1.0.13
      // - Version 1.0.13
      newContent = content.replace(
        /(ContentInspector\s+v|版本\s+|Version\s+)\d+\.\d+\.\d+/gi,
        `$1${newVersion}`
      );
    } else {
      // 处理 JSON 文件
      const json = JSON.parse(content);
      json.version = newVersion;
      newContent = JSON.stringify(json, null, 2) + '\n';
    }

    fs.writeFileSync(file.path, newContent, 'utf-8');
    console.log(`✅ ${file.name}`);
    successCount++;
  } catch (error) {
    console.error(`❌ ${file.name}: ${error.message}`);
    failCount++;
  }
});

console.log('\n' + '='.repeat(50));
console.log(`更新完成！成功: ${successCount}, 失败: ${failCount}`);

if (failCount === 0) {
  console.log(`\n🎉 版本已成功更新到 ${newVersion}`);
  console.log('\n下一步:');
  console.log('1. 提交更改: git add .');
  console.log(`2. 创建标签: git tag v${newVersion}`);
  console.log('3. 推送: git push && git push --tags');
} else {
  console.log('\n⚠️  部分文件更新失败，请检查上述错误信息');
  process.exit(1);
}

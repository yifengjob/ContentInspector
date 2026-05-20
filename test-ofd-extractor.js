/**
 * OFD 提取器测试脚本
 * 
 * 使用方法：
 * node test-ofd-extractor.js [path/to/test.ofd]
 */

const path = require('path');
const fs = require('fs');

// 检查是否有测试文件参数
const testFilePath = process.argv[2];

if (!testFilePath) {
  console.log('❌ 请提供 OFD 测试文件路径');
  console.log('用法: node test-ofd-extractor.js /path/to/file.ofd');
  console.log('\n如果没有测试文件，可以：');
  console.log('1. 从网上下载一个示例 OFD 文件');
  console.log('2. 使用 WPS 或福昕阅读器导出一个 OFD 文件');
  console.log('3. 联系相关部门获取测试用的 OFD 发票或公文');
  process.exit(1);
}

// 验证文件是否存在
if (!fs.existsSync(testFilePath)) {
  console.error(`❌ 文件不存在: ${testFilePath}`);
  process.exit(1);
}

// 验证文件扩展名
const ext = path.extname(testFilePath).toLowerCase();
if (ext !== '.ofd') {
  console.error(`❌ 文件扩展名不是 .ofd: ${ext}`);
  process.exit(1);
}

console.log('🔍 开始测试 OFD 提取器...\n');
console.log(`📄 测试文件: ${testFilePath}`);
console.log(`📏 文件大小: ${(fs.statSync(testFilePath).size / 1024).toFixed(2)} KB\n`);

// 动态导入 TypeScript 模块（需要 ts-node 或编译后的 JS）
async function testOfdExtractor() {
  try {
    // 尝试加载编译后的模块
    let extractOfd;
    
    try {
      // 从 dist 目录加载编译后的模块
      const module = require('./dist/extractors/ofd/ofd-extractor.js');
      extractOfd = module.extractOfd;
      console.log('✅ 使用编译后的模块\n');
    } catch (e) {
      console.log('⚠️  未找到编译后的模块，尝试使用 ts-node...');
      
      try {
        // 使用 ts-node 直接运行 TypeScript
        require('ts-node').register({
          project: './tsconfig.json',
          transpileOnly: true,
        });
        
        const module = require('./src/extractors/ofd/ofd-extractor.ts');
        extractOfd = module.extractOfd;
        console.log('✅ 使用 ts-node 加载模块\n');
      } catch (tsError) {
        throw new Error(`无法加载 OFD 提取器模块:\n1. 编译版本: ${e.message}\n2. ts-node: ${tsError.message}`);
      }
    }
    
    if (!extractOfd) {
      throw new Error('无法加载 OFD 提取器模块');
    }
    
    console.log('✅ OFD 提取器模块加载成功\n');
    console.log('⏳ 开始提取文本...\n');
    
    const startTime = Date.now();
    
    // 执行提取
    const result = await extractOfd(testFilePath);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 提取结果:\n');
    console.log(`⏱️  耗时: ${duration} ms`);
    console.log(`📝 文本长度: ${result.text.length} 字符`);
    console.log(`🏷️  提取器: ${result.extractorName}`);
    console.log(`⚠️  不支持预览: ${result.unsupportedPreview ? '是' : '否'}`);
    
    if (result.text.length > 0) {
      console.log('\n📖 文本预览（前 500 字符）:\n');
      console.log('─'.repeat(60));
      console.log(result.text.substring(0, 500));
      if (result.text.length > 500) {
        console.log('\n... (省略后续内容)');
      }
      console.log('─'.repeat(60));
      
      console.log('\n✅ 测试成功！OFD 提取器工作正常。');
      
      // 保存完整文本到文件
      const outputPath = testFilePath.replace('.ofd', '_extracted.txt');
      fs.writeFileSync(outputPath, result.text, 'utf-8');
      console.log(`\n💾 完整文本已保存到: ${outputPath}`);
    } else {
      console.log('\n⚠️  警告: 未能提取到文本');
      console.log('\n可能的原因:');
      console.log('1. OFD 文件为空或只包含图片');
      console.log('2. OFD 文件已加密');
      console.log('3. OFD 文件格式不符合预期结构');
      console.log('4. 文本存储在不同的 XML 标签中');
      
      console.log('\n💡 建议:');
      console.log('- 检查 OFD 文件是否包含可选择的文本');
      console.log('- 尝试其他 OFD 测试文件');
      console.log('- 查看日志输出了解详细错误信息');
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('\n❌ 测试失败:\n');
    console.error(`错误类型: ${error.constructor.name}`);
    console.error(`错误消息: ${error.message}`);
    
    if (error.stack) {
      console.error('\n堆栈跟踪:');
      console.error(error.stack.split('\n').slice(0, 10).join('\n'));
    }
    
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(1);
  }
}

// 执行测试
testOfdExtractor();

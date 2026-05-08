const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
    const svgPath = path.join(__dirname, '../frontend/src/assets/icon.svg');
    const buildDir = path.join(__dirname, '../build');

    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir, {recursive: true});
    }

    console.log('正在从SVG生成图标...');
    console.log('源文件:', svgPath);

    try {
        // 生成PNG (512x512) - 用于Linux和开发环境
        await sharp(svgPath)
            .resize(512, 512)
            .png()
            .toFile(path.join(buildDir, 'icons', 'icon.png'));
        console.log('✓ 已生成: build/icons/icon.png (512x512)');

        // 生成较小的PNG用于测试
        await sharp(svgPath)
            .resize(256, 256)
            .png()
            .toFile(path.join(buildDir,'icons', 'icon-256.png'));
        console.log('✓ 已生成: build/icons/icon-256.png (256x256)');

        console.log('\n✓ 图标生成完成！');
        console.log('\n注意：');
        console.log('- icon.png 已可用于开发环境和Linux');
        console.log('- Windows需要icon.ico格式（可使用在线工具转换）');
        console.log('- macOS需要icon.icns格式（可使用在线工具转换）');

    } catch (error) {
        console.error('✗ 图标生成失败:', error.message);
        console.error('\n请确保已安装sharp: pnpm add -D sharp');
    }
}

generateIcons();

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 获取当前日期和时间
// Semver 格式: MAJOR.MINOR.PATCH
const now = new Date();
const year = String(now.getFullYear()); // 2026
const month = String(now.getMonth() + 1).padStart(2, '0'); // 04
const day = String(now.getDate()).padStart(2, '0'); // 12
const hour = String(now.getHours()).padStart(2, '0'); // 16
const minute = String(now.getMinutes()).padStart(2, '0'); // 15

// 使用年份后两位作为主版本号，格式: YY.MM.DD.HHMM
// 但 semver 不支持 4 段式，所以我们使用: YY.MM.DD (例如: 26.4.12)
// 构建信息可以放在文件名或元数据中
const major = year.slice(-2); // 26
const minor = parseInt(month, 10); // 4
const patch = parseInt(day, 10); // 12
const version = `${major}.${minor}.${patch}`;

const buildInfo = `${year}${month}${day}${hour}${minute}`; // 202604121615

console.log(`构建版本: ${version}`);
console.log(`构建信息: ${buildInfo}`);

// 替换 tauri.conf.json 中的版本号
const tauriConfigPath = path.join(__dirname, 'src-tauri', 'tauri.conf.json');
let configContent = fs.readFileSync(tauriConfigPath, 'utf8');
configContent = configContent.replace('__VERSION__', version);
fs.writeFileSync(tauriConfigPath, configContent);

console.log(`版本号已更新为: ${version}`);

let buildSuccess = false;
try {
  // 执行 Tauri 构建
  execSync('npm run build', { stdio: 'inherit' });
  buildSuccess = true;
} catch (error) {
  console.error('\n⚠️  构建过程中出现错误，但如果看到安装包已生成，可能是签名配置问题，不影响使用。');
  console.error('错误信息:', error.message);

  // 检查是否有安装包生成
  const bundlePath = path.join(__dirname, 'src-tauri', 'target', 'release', 'bundle');
  const nsisPath = path.join(bundlePath, 'nsis', `NUCtool_${version}_x64-setup.exe`);
  const msiPath = path.join(bundlePath, 'msi', `NUCtool_${version}_x64_zh-CN.msi`);

  if (fs.existsSync(nsisPath) || fs.existsSync(msiPath)) {
    console.log('\n✅ 检测到安装包已生成，构建成功！');
    buildSuccess = true;
  } else {
    console.error('\n❌ 未检测到安装包，构建确实失败了。');
  }
}

// 恢复原版本号
configContent = fs.readFileSync(tauriConfigPath, 'utf8');
configContent = configContent.replace(version, '__VERSION__');
fs.writeFileSync(tauriConfigPath, configContent);

if (buildSuccess) {
  console.log(`\n✅ 构建完成！`);
  console.log(`📦 版本: ${version}`);
  console.log(`🕐 构建时间: ${buildInfo}`);
  console.log(`\n📂 安装包位置:`);
  console.log(`   MSI:  src-tauri\\target\\release\\bundle\\msi\\NUCtool_${version}_x64_zh-CN.msi`);
  console.log(`   NSIS: src-tauri\\target\\release\\bundle\\nsis\\NUCtool_${version}_x64-setup.exe`);
} else {
  console.error('\n❌ 构建失败，请检查错误信息。');
  process.exit(1);
}

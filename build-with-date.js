import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const TAURI_CONFIG = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_TOML = path.join(ROOT, 'src-tauri', 'Cargo.toml');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACKAGE_LOCK = path.join(ROOT, 'package-lock.json');

const args = new Set(process.argv.slice(2));
const shouldPrintOnly = args.has('--print');
const shouldFrontendOnly = args.has('--frontend-only');
const shouldKeepVersion = args.has('--keep-version');
const granularity = process.env.BUILD_VERSION_GRANULARITY || 'minute';

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function buildVersion(now = new Date(), mode = granularity) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();
  const minute = now.getMinutes();

  const major = year % 100;
  // MSI versions require each of the first two components to be <= 255.
  // Keep the month readable and pack day/hour/minute into the patch component
  // (maximum 65019), so date builds remain unique without breaking MSI.
  const minor = month;
  const patch =
    mode === 'day'
      ? day
      : day * 2048 + hour * 64 + (mode === 'hour' ? 0 : minute);

  return {
    version: `${major}.${minor}.${patch}`,
    buildInfo: `${year}${pad(month)}${pad(day)}${pad(hour)}${pad(minute)}`,
    humanTime: `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`,
    mode,
  };
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, content) {
  fs.writeFileSync(file, content);
}

function updateJsonVersion(file, version) {
  const content = readText(file);
  const json = JSON.parse(content);
  json.version = version;
  if (json.packages?.['']) {
    json.packages[''].version = version;
  }
  writeText(file, `${JSON.stringify(json, null, 2)}\n`);
  return content;
}

function updateCargoTomlVersion(file, version) {
  const content = readText(file);
  const updated = content.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`,
  );
  writeText(file, updated);
  return content;
}

function updateTauriConfigVersion(file, version) {
  return updateJsonVersion(file, version);
}

function restore(files) {
  for (const [file, content] of files.reverse()) {
    writeText(file, content);
  }
}

function findBundleOutputs(version) {
  const bundleRoot = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle');
  const results = [];
  for (const dir of ['nsis', 'msi']) {
    const fullDir = path.join(bundleRoot, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of fs.readdirSync(fullDir)) {
      if (file.includes(version)) {
        results.push(path.join(fullDir, file));
      }
    }
  }
  return results;
}

const build = buildVersion();

console.log(`构建版本: ${build.version}`);
console.log(`构建时间: ${build.humanTime}`);
console.log(`版本粒度: ${build.mode}`);

if (shouldPrintOnly) {
  process.exit(0);
}

const originals = [];

try {
  originals.push([TAURI_CONFIG, updateTauriConfigVersion(TAURI_CONFIG, build.version)]);
  originals.push([CARGO_TOML, updateCargoTomlVersion(CARGO_TOML, build.version)]);
  originals.push([PACKAGE_JSON, updateJsonVersion(PACKAGE_JSON, build.version)]);
  if (fs.existsSync(PACKAGE_LOCK)) {
    originals.push([PACKAGE_LOCK, updateJsonVersion(PACKAGE_LOCK, build.version)]);
  }

  console.log(`版本号已临时更新为: ${build.version}`);
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  if (!shouldFrontendOnly) {
    const hasUpdaterSigningKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
    if (!hasUpdaterSigningKey) {
      console.log('未提供更新包私钥：仅生成本地 NSIS/MSI 安装包，跳过更新包签名。');
    }
    const tauriBuildCommand = hasUpdaterSigningKey
      ? 'npm run tauri:build'
      : 'npm run tauri:build -- --config src-tauri/tauri.local-unsigned.conf.json';
    execSync(tauriBuildCommand, { cwd: ROOT, stdio: 'inherit' });
  }

  const outputs = findBundleOutputs(build.version);
  console.log('\n✅ 构建完成');
  console.log(`📦 版本: ${build.version}`);
  console.log(`🕐 构建时间: ${build.buildInfo}`);
  if (outputs.length > 0) {
    console.log('\n📂 安装包位置:');
    for (const output of outputs) {
      console.log(`   ${path.relative(ROOT, output)}`);
    }
  } else if (!shouldFrontendOnly) {
    console.log('\n⚠️ 未在 bundle 目录中找到带当前版本号的安装包，请检查 Tauri 输出日志。');
  }
} finally {
  if (!shouldKeepVersion) {
    restore(originals);
    console.log('\n版本文件已恢复为打包前状态。');
  } else {
    console.log('\n已按 --keep-version 保留时间版本号。');
  }
}

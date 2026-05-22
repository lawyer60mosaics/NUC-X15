#!/bin/bash

# 获取当前日期和时间
VERSION=$(date +"%Y.%m.%d.%H%M")
echo "构建版本: $VERSION"

# 替换 tauri.conf.json 中的版本号
cd src-tauri
sed -i "s/__VERSION__/$VERSION/g" tauri.conf.json

echo "版本号已更新为: $VERSION"

# 执行 Tauri 构建
cd ..
npm run build

# 恢复原版本号（可选，如果不恢复则保留当前日期版本）
cd src-tauri
sed -i "s/$VERSION/__VERSION__/g" tauri.conf.json

echo "构建完成"

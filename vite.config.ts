import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 防止 Vite 混淆 Tauri 进程环境变量
  clearScreen: false,
  // Tauri 使用的端口，在 tauri.conf.json 中需要一致
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  // 构建产物输出目录
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  }
})

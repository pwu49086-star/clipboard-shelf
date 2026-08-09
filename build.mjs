// Build script: copy main/preload to out/, Vite for renderer
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

async function buildMain() {
  copyDir(path.resolve(__dirname, 'src/main'), path.resolve(__dirname, 'out/main'))
  console.log('✓ main process copied')
}

async function buildPreload() {
  copyDir(path.resolve(__dirname, 'src/preload'), path.resolve(__dirname, 'out/preload'))
  console.log('✓ preload copied')
}

async function buildRenderer() {
  await build({
    root: path.resolve(__dirname, 'src/renderer'),
    base: './',
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  })

  // 复制独立 HTML 页面（pet.html, editor.html, screenshot.html）
  const extraHtml = ['pet.html', 'editor.html', 'screenshot.html', 'pin.html']
  const outDir = path.resolve(__dirname, 'out/renderer')
  for (const file of extraHtml) {
    const src = path.resolve(__dirname, 'src/renderer', file)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, file))
    }
  }
  console.log('✓ renderer built')
}

async function main() {
  try {
    await Promise.all([buildMain(), buildPreload(), buildRenderer()])
    console.log('\n✓ all built successfully')
  } catch (e) {
    console.error('Build failed:', e)
    process.exit(1)
  }
}

main()

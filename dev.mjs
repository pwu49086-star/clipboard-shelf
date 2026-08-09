// Dev script: copy main/preload + Vite dev server + Electron
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const electronPath = require('electron')

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

function copyMainProcess() {
  copyDir(path.resolve(__dirname, 'src/main'), path.resolve(__dirname, 'out/main'))
  copyDir(path.resolve(__dirname, 'src/preload'), path.resolve(__dirname, 'out/preload'))
}

async function main() {
  // 1. Copy main + preload initially
  copyMainProcess()
  console.log('✓ main + preload copied')

  // 2. Watch for changes in main/preload
  const watchDirs = ['src/main', 'src/preload']
  for (const dir of watchDirs) {
    fs.watch(path.resolve(__dirname, dir), { recursive: true }, () => {
      copyMainProcess()
      console.log('⟳ main/preload re-copied')
    })
  }

  // 3. Start Vite dev server for renderer
  const viteServer = await createServer({
    root: path.resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    server: { port: 5173 }
  })
  await viteServer.listen()
  const viteUrl = `http://localhost:${viteServer.config.server.port}`
  console.log(`✓ renderer dev server at ${viteUrl}`)

  // 4. Launch Electron (必须清除 ELECTRON_RUN_AS_NODE)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.ELECTRON_RENDERER_URL = viteUrl
  env.NODE_ENV = 'development'

  const electronProc = spawn(electronPath, ['.', '--no-sandbox'], {
    cwd: __dirname,
    stdio: 'inherit',
    env
  })

  electronProc.on('close', () => {
    viteServer.close()
    process.exit(0)
  })

  process.on('SIGINT', () => {
    electronProc.kill()
  })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

/**
 * OCR Service - 文字识别服务（事件驱动）
 *
 * 监听 OCR_START 事件，完成后发出 OCR_DONE 事件
 * 自动检测 Python 路径
 */

const { execFile, exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { eventBus, Events } = require('../core/event-bus')

// 打包模式用 process.resourcesPath，开发模式用项目根目录
const { app } = require('electron')
const SCRIPT_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'ocr.py')
  : path.resolve(__dirname, '../../../scripts/ocr.py')

// ====== Python 检测（异步，不阻塞主线程） ======
let pythonPath = null
let pythonDetecting = false
let pythonDetectCallbacks = []

function detectPythonAsync() {
  if (pythonPath) return Promise.resolve(pythonPath)
  if (pythonDetecting) {
    return new Promise(resolve => pythonDetectCallbacks.push(resolve))
  }
  pythonDetecting = true

  return new Promise((resolve) => {
    // 1. 从配置读取
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json')
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.pythonPath && fs.existsSync(config.pythonPath)) {
        pythonPath = config.pythonPath
        pythonDetecting = false
        resolve(pythonPath)
        pythonDetectCallbacks.forEach(cb => cb(pythonPath))
        pythonDetectCallbacks = []
        return
      }
    } catch {}

    // 2. 常见路径列表
    const candidates = [
      'py', 'python', 'python3',
      path.join(os.homedir(), 'AppData\\Local\\Python\\bin\\python.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python314\\python.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python313\\python.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python312\\python.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Programs\\Python\\Python311\\python.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Microsoft\\WindowsApps\\python.exe'),
    ]

    // 自动发现 AppData\Local\Python\pythoncore-*\python.exe（如 pythoncore-3.14-64）
    const pythonCoreDir = path.join(os.homedir(), 'AppData\\Local\\Python')
    try {
      if (fs.existsSync(pythonCoreDir)) {
        for (const dir of fs.readdirSync(pythonCoreDir)) {
          if (dir.startsWith('pythoncore-')) {
            const exe = path.join(pythonCoreDir, dir, 'python.exe')
            if (fs.existsSync(exe)) candidates.push(exe)
          }
        }
      }
    } catch {}

    let i = 0
    function tryNext() {
      if (i >= candidates.length) {
        pythonDetecting = false
        resolve(null)
        pythonDetectCallbacks.forEach(cb => cb(null))
        pythonDetectCallbacks = []
        return
      }
      const c = candidates[i++]
      exec(`"${c}" --version`, { encoding: 'utf-8', windowsHide: true, timeout: 5000 }, (err, stdout) => {
        if (!err && stdout) {
          pythonPath = c
          pythonDetecting = false
          resolve(pythonPath)
          pythonDetectCallbacks.forEach(cb => cb(pythonPath))
          pythonDetectCallbacks = []
        } else {
          tryNext()
        }
      })
    }
    tryNext()
  })
}

function getPythonPath() {
  return pythonPath
}

// ====== Recognize ======
async function recognize(imagePath, timeoutMs = 30000) {
  const py = getPythonPath() || await detectPythonAsync()
  if (!py) {
    throw new Error('Python not found. Please install Python or set pythonPath in config.json')
  }
  return new Promise((resolve, reject) => {
    execFile(py, [SCRIPT_PATH, imagePath], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) {
        reject(err)
        return
      }
      const text = Buffer.isBuffer(stdout) ? stdout.toString('utf-8').trim() : String(stdout).trim()
      resolve(text || null)
    })
  })
}

function recognizeBase64(base64Data) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(os.tmpdir(), 'clipboard-shelf')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpFile = path.join(tmpDir, `ocr_${crypto.randomUUID()}.png`)
    const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    fs.writeFileSync(tmpFile, buffer)

    recognize(tmpFile)
      .then(text => {
        try { fs.unlinkSync(tmpFile) } catch {}
        resolve(text)
      })
      .catch(err => {
        try { fs.unlinkSync(tmpFile) } catch {}
        reject(err)
      })
  })
}

// ====== Init ======
function init() {
  // 监听 OCR 启动事件
  eventBus.on(Events.OCR_JOB, async ({ filePath, itemId }) => {
    try {
      const text = await recognize(filePath)
      if (text) {
        eventBus.emit(Events.OCR_DONE, { id: itemId, text, filePath })
      }
    } catch (err) {
      console.error('[OCRService] Error:', err.message)
    }
  })
}

module.exports = { init, recognize, recognizeBase64, getPythonPath }

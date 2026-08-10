/**
 * Source Capture - 常驻 PowerShell source service（零 npm 依赖）
 *
 * v1.4.1：
 *   - Clipboard Shelf 启动时启动一个常驻 PowerShell 子进程；
 *   - Add-Type / Win32 API 只初始化一次，之后查询走 stdin/stdout 行协议；
 *   - 每次查询返回独立的新鲜 snapshot，禁止旧快照跨 item 复用；
 *   - 单飞串行：同一时间只有一个 outstanding query，FIFO 排队；
 *   - 自身窗口（Clipboard Shelf）返回 null；
 *   - 任何失败（启动失败/异常退出/EOF/超时/格式错误/卡死）→ null，
 *     剪贴板记录流程继续，必要时自动重启 worker。
 */

const { spawn } = require('child_process')
const readline = require('readline')

// ====== 可调参数（测试可覆盖） ======
let QUERY_TIMEOUT_MS = 2000
let RESTART_COOLDOWN_MS = 2000
const BOOT_TIMEOUT_MS = 8000

const PS_SERVICE_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class FGWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  }' -ErrorAction Stop
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
} catch {
  [Console]::Out.WriteLine('ERROR|BOOT:' + $_.Exception.Message)
  [Console]::Out.Flush()
  exit 1
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line.Length -lt 2 -or $line[0] -ne 'Q') { continue }
  $id = $line.Substring(1)
  try {
    $h = [FGWin]::GetForegroundWindow()
    $p = 0
    if ($h -ne [IntPtr]::Zero) { [void][FGWin]::GetWindowThreadProcessId($h, [ref]$p) }
    $name = ''
    if ($p -gt 0) {
      $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
      if ($proc) { $name = $proc.ProcessName }
    }
    [Console]::Out.WriteLine('RESULT|' + $id + '|' + $p + '|' + $name)
  } catch {
    [Console]::Out.WriteLine('ERROR|' + $_.Exception.Message)
  }
  [Console]::Out.Flush()
}
`

// ====== Transport（真实 PowerShell / 测试可注入） ======
function createPowerShellTransport() {
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SERVICE_SCRIPT
  ], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const handlers = { line: new Set(), exit: new Set(), error: new Set() }
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (l) => {
    const t = String(l).trim()
    if (t) handlers.line.forEach(cb => cb(t))
  })
  rl.on('close', () => handlers.exit.forEach(cb => cb(0, 'eof')))
  child.on('error', (err) => handlers.error.forEach(cb => cb(err)))
  child.on('exit', (code, signal) => handlers.exit.forEach(cb => cb(code, signal)))
  child.stderr.on('data', (d) => {
    const s = String(d).trim()
    if (s) stats.lastStderr = s.slice(-500)
  })

  return {
    write(line) {
      try {
        if (child.stdin && child.stdin.writable) child.stdin.write(line + '\n')
      } catch {}
    },
    kill() {
      try { child.kill() } catch {}
    },
    onLine(cb) { handlers.line.add(cb) },
    onExit(cb) { handlers.exit.add(cb) },
    onError(cb) { handlers.error.add(cb) },
    isAlive() { return child.exitCode === null && !child.killed }
  }
}

let transportFactory = createPowerShellTransport

// ====== 解析 ======
function parseForegroundOutput(stdout) {
  if (!stdout) return null
  const line = String(stdout).split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0)
  if (!line) return null
  const parts = line.split('|')
  if (!parts[0] || !parts[1]) return null
  const app = parts[0].toLowerCase()
  return { app, process: app + '.exe', pid: parseInt(parts[1], 10) || null }
}

// 响应行：RESULT|<id>|<pid>|<app>
function parseResultLine(line) {
  const parts = String(line).split('|')
  const id = Number(parts[1])
  const pidRaw = parts[2]
  const appRaw = parts.slice(3).join('|').trim()
  const pid = Number(pidRaw) || null
  const app = appRaw ? appRaw.toLowerCase() : null
  if (!Number.isInteger(id) || (!app && !pid)) return null
  return { id, pid, app, process: app ? app + '.exe' : null }
}

// ====== 自身窗口判断 ======
const SELF_APP_RE = /^clipboard[- ]shelf/i

function isSelfSource(source) {
  if (!source) return false
  if (source.pid && Number(source.pid) === process.pid) return true
  const app = String(source.app || '')
  return app === 'electron' || SELF_APP_RE.test(app)
}

// ====== 服务状态 ======
let transport = null
let ready = false
let starting = false
let bootPromise = null
let bootTimer = null
let pendingQuery = null // { id, resolve, timer }
let queryQueue = []
let draining = false
let querySeq = 0
let captureImplOverride = null

const stats = {
  startedAt: null,
  lastRestartAt: 0,
  coldStartMs: null,
  queryCount: 0,
  restartCount: 0,
  queryTimes: [],
  lastError: null,
  lastStderr: ''
}

function onWorkerDown() {
  ready = false
  starting = false
  transport = null
  if (pendingQuery) {
    clearTimeout(pendingQuery.timer)
    const p = pendingQuery
    pendingQuery = null
    p.resolve(null)
  }
}

function ensureStarted() {
  if (ready) return Promise.resolve(true)
  if (bootPromise) return bootPromise
  if (Date.now() - stats.lastRestartAt < RESTART_COOLDOWN_MS) {
    stats.lastError = 'restart cooldown'
    return Promise.resolve(false)
  }

  bootPromise = new Promise((resolve) => {
    stats.lastRestartAt = Date.now()
    if (!stats.startedAt) {
      stats.startedAt = Date.now()
    } else {
      stats.restartCount++
    }
    let settled = false
    const settle = (ok) => {
      if (settled) return
      settled = true
      starting = false
      bootPromise = null
      resolve(ok)
    }

    let t = null
    try {
      t = transportFactory()
      transport = t
    } catch (err) {
      stats.lastError = String(err && err.message || err)
      settle(false)
      return
    }
    starting = true
    bootTimer = setTimeout(() => {
      stats.lastError = 'boot timeout'
      if (transport) transport.kill()
      settle(false)
    }, BOOT_TIMEOUT_MS)

    t.onLine((line) => {
      if (transport !== t) return
      if (line === 'READY') {
        clearTimeout(bootTimer)
        ready = true
        stats.coldStartMs = Date.now() - stats.lastRestartAt
        settle(true)
        drainQueue()
      } else if (line.startsWith('RESULT|')) {
        handleResultLine(line)
      } else if (line.startsWith('ERROR|')) {
        handleErrorLine(line)
      }
    })
    t.onExit(() => {
      if (transport !== t) return
      clearTimeout(bootTimer)
      onWorkerDown()
      settle(false)
    })
    t.onError((err) => {
      if (transport !== t) return
      stats.lastError = String(err && err.message || err)
      clearTimeout(bootTimer)
      onWorkerDown()
      settle(false)
    })
  })
  return bootPromise
}

function handleResultLine(line) {
  const parsed = parseResultLine(line)
  if (!parsed || !pendingQuery || pendingQuery.id !== parsed.id) {
    stats.lastError = 'protocol mismatch: ' + line.slice(0, 120)
    if (transport) transport.kill()
    if (pendingQuery) {
      const p = pendingQuery
      pendingQuery = null
      p.resolve(null)
    }
    return
  }
  const p = pendingQuery
  pendingQuery = null
  stats.queryCount++
  const source = (parsed.app || parsed.pid) ? { app: parsed.app, process: parsed.process, pid: parsed.pid } : null
  p.resolve(isSelfSource(source) ? null : source)
}

function handleErrorLine(line) {
  stats.lastError = line.slice(6)
  if (pendingQuery) {
    const p = pendingQuery
    pendingQuery = null
    p.resolve(null)
  }
}

function executeQuery() {
  return new Promise((resolve) => {
    if (!transport) {
      resolve(null)
      return
    }
    const id = ++querySeq
    const t0 = Date.now()
    const finish = (v) => {
      stats.queryTimes.push(Date.now() - t0)
      if (stats.queryTimes.length > 200) stats.queryTimes.shift()
      resolve(v)
    }
    const timer = setTimeout(() => {
      stats.lastError = 'query timeout'
      if (transport) transport.kill()
      finish(null)
    }, QUERY_TIMEOUT_MS)
    pendingQuery = {
      id,
      timer,
      resolve: (v) => { clearTimeout(timer); finish(v) }
    }
    transport.write('Q' + id)
  })
}

async function drainQueue() {
  if (draining) return
  draining = true
  try {
    while (queryQueue.length > 0) {
      if (!ready) {
        // 后台启动/重启 worker，不阻塞管线；本次排队请求直接返回 null
        ensureStarted()
        while (queryQueue.length > 0) queryQueue.shift().resolve(null)
        break
      }
      const req = queryQueue.shift()
      const result = await executeQuery()
      req.resolve(result)
    }
  } finally {
    draining = false
  }
}

// ====== 对外 API ======

/**
 * 启动常驻 service（预热 Add-Type）。幂等。
 */
function start() {
  if (captureImplOverride) return Promise.resolve(true)
  return ensureStarted()
}

/**
 * 获取当前前台应用（独立新鲜快照；失败返回 null，不抛错）。
 */
async function getForegroundSource() {
  if (captureImplOverride) return captureImplOverride()
  return new Promise((resolve) => {
    queryQueue.push({ resolve })
    drainQueue()
  })
}

function stop() {
  if (bootTimer) clearTimeout(bootTimer)
  if (pendingQuery) {
    clearTimeout(pendingQuery.timer)
    pendingQuery.resolve(null)
    pendingQuery = null
  }
  queryQueue = []
  if (transport) transport.kill()
  transport = null
  ready = false
  starting = false
  bootPromise = null
}

function getStats() {
  const times = [...stats.queryTimes].sort((a, b) => a - b)
  const pct = (q) => times.length
    ? times[Math.min(times.length - 1, Math.floor(times.length * q))]
    : null
  return {
    ready,
    coldStartMs: stats.coldStartMs,
    queryCount: stats.queryCount,
    restartCount: stats.restartCount,
    sampleCount: times.length,
    p50: pct(0.5),
    p95: pct(0.95),
    max: times.length ? times[times.length - 1] : null,
    lastError: stats.lastError,
    lastStderr: stats.lastStderr
  }
}

// ====== 测试钩子 ======
function _setTransportFactory(fn) {
  transportFactory = typeof fn === 'function' ? fn : createPowerShellTransport
}

function _setCaptureImpl(fn) {
  captureImplOverride = typeof fn === 'function' ? fn : null
}

function _setQueryTimeout(ms) {
  QUERY_TIMEOUT_MS = ms
}

function _setRestartCooldown(ms) {
  RESTART_COOLDOWN_MS = ms
}

function _reset() {
  if (bootTimer) clearTimeout(bootTimer)
  if (pendingQuery) {
    clearTimeout(pendingQuery.timer)
    pendingQuery.resolve(null)
    pendingQuery = null
  }
  queryQueue = []
  draining = false
  if (transport) transport.kill()
  transport = null
  ready = false
  starting = false
  bootPromise = null
  captureImplOverride = null
  transportFactory = createPowerShellTransport
  QUERY_TIMEOUT_MS = 2000
  RESTART_COOLDOWN_MS = 2000
  stats.startedAt = null
  stats.lastRestartAt = 0
  stats.coldStartMs = null
  stats.queryCount = 0
  stats.restartCount = 0
  stats.queryTimes = []
  stats.lastError = null
  stats.lastStderr = ''
}

module.exports = {
  start,
  stop,
  getForegroundSource,
  parseForegroundOutput,
  parseResultLine,
  isSelfSource,
  getStats,
  _test: {
    _setTransportFactory,
    _setCaptureImpl,
    _setQueryTimeout,
    _setRestartCooldown,
    _reset
  }
}

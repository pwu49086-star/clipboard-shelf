/**
 * Clipboard Pipeline - 剪贴板处理管线
 *
 * 流程: poll → normalize → hash filter → queue → async worker
 *
 * 解耦: 通过 EventBus 发出事件，不直接调用 DB/OCR/UI
 */

const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { eventBus, Events } = require('../core/event-bus')
const { getForegroundSource, isSelfSource } = require('./source-capture')
const { shouldCapture } = require('./capture-policy')

// ====== Capture Policy（捕获策略） ======
let options = { enabled: true, skipSensitive: true, ignoreApps: [], metadataOnlyApps: [] }

function setOptions(opts) {
  if (!opts) return
  if (typeof opts.enabled === 'boolean') options.enabled = opts.enabled
  if (typeof opts.pause === 'boolean') options.enabled = !opts.pause // 兼容旧配置
  if (typeof opts.skipSensitive === 'boolean') options.skipSensitive = opts.skipSensitive
  if (Array.isArray(opts.ignoreApps)) options.ignoreApps = opts.ignoreApps
  if (Array.isArray(opts.metadataOnlyApps)) options.metadataOnlyApps = opts.metadataOnlyApps
}

// ====== Config ======
const POLL_INTERVAL = 1000 // 1s
const QUEUE_MAX = 50

// ====== State ======
let pollTimer = null
const seenTextHashes = new Set()   // 全局文字去重
const seenImageHashes = new Set()  // 全局图片去重
let lastImageSize = { width: 0, height: 0 } // 快速预判用
let lastProcessTime = 0
let queue = []
let processing = false
let imagesDir = ''
let skipCount = 0

// ====== Hash ======
function hashBuffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex')
}

function hashText(text) {
  return crypto.createHash('md5').update(text).digest('hex')
}

// ====== Normalize ======
function normalizeText(text) {
  if (!text) return null
  // 统一换行符、去掉首尾空白、合并连续空格
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .replace(/[ \t]+/g, ' ')
  if (!normalized) return null
  return normalized
}

// ====== Queue ======
function enqueue(item) {
  if (queue.length >= QUEUE_MAX) {
    queue.shift() // 丢弃最旧的
  }
  queue.push(item)
  processQueue()
}

async function processQueue() {
  if (processing || queue.length === 0) return
  processing = true

  while (queue.length > 0) {
    const item = queue.shift()
    try {
      await processItem(item)
    } catch (err) {
      console.error('[ClipboardPipeline] Process error:', err)
    }
  }

  processing = false
}

// ====== Process Item ======
async function processItem(item) {
  // 使用检测时刻随 item 携带的来源快照；worker 禁止重新获取前台窗口
  let source = null
  try {
    source = await (item.sourcePromise || Promise.resolve(item.source || null))
  } catch {
    source = null
  }
  source = isSelfSource(source) ? null : source
  const extra = {
    sourceApp: source ? source.app : null,
    sourceProcess: source ? source.process : null,
    capturedAt: item.capturedAt || Date.now()
  }

  if (item.type === 'text') {
    const decision = shouldCapture({ text: item.content, sourceApp: extra.sourceApp, options })
    if (decision.action === 'ignore') return
    eventBus.emit(Events.CLIPBOARD_TEXT, {
      type: 'text',
      content: decision.action === 'metadata' ? null : item.content,
      metadataOnly: decision.action === 'metadata' ? 1 : 0,
      sensitivity: decision.sensitivity,
      createTime: Date.now(),
      ...extra
    })
  } else if (item.type === 'image') {
    const decision = shouldCapture({ text: '', sourceApp: extra.sourceApp, options })
    if (decision.action === 'ignore') return

    // PNG 编码/去重/落盘都在 worker 中执行，不阻塞复制事件
    const pngBuffer = item.image.toPNG()
    const hash = hashBuffer(pngBuffer)
    if (seenImageHashes.has(hash)) return
    seenImageHashes.add(hash)
    if (seenImageHashes.size > 500) {
      const arr = [...seenImageHashes]
      arr.splice(0, 250)
      seenImageHashes.clear()
      arr.forEach(h => seenImageHashes.add(h))
    }

    const saved = decision.action === 'metadata' ? null : saveImage(item.image, pngBuffer)

    eventBus.emit(Events.CLIPBOARD_IMAGE, {
      type: 'image',
      content: saved ? saved.filename : null,
      filePath: saved ? saved.filePath : null,
      thumbPath: saved ? saved.thumbPath : null,
      metadataOnly: decision.action === 'metadata' ? 1 : 0,
      sensitivity: 0,
      createTime: Date.now(),
      fileSize: saved ? saved.fileSize : null,
      imageWidth: saved ? saved.width : null,
      imageHeight: saved ? saved.height : null,
      ...extra
    })
  }
}

// ====== Save Image ======
function saveImage(img, cachedPngBuffer) {
  try {
    const base = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const filename = `${base}.png`
    const fullPath = path.join(imagesDir, 'full', filename)
    const thumbName = `${base}.jpg`
    const thumbPath = path.join(imagesDir, 'thumb', thumbName)

    // setImageDir() 已保证目录存在，无需重复创建

    const pngBuffer = cachedPngBuffer || img.toPNG()
    fs.writeFileSync(fullPath, pngBuffer)

    // 缩略图 200px
    const thumb = img.resize({ width: 200 })
    fs.writeFileSync(thumbPath, thumb.toJPEG(80))

    const size = img.getSize()
    const stat = fs.statSync(fullPath)

    return {
      filename,
      filePath: fullPath,
      thumbPath,
      fileSize: stat.size,
      width: size.width,
      height: size.height
    }
  } catch (err) {
    console.error('[ClipboardPipeline] Save image error:', err)
    return null
  }
}

// ====== Poll ======
function checkClipboard() {
  try {
    const { clipboard } = require('electron')
    if (!options.enabled) return
    if (skipCount > 0) {
      skipCount--
      return
    }

    const now = Date.now()

    const img = clipboard.readImage()
    if (img && !img.isEmpty()) {
      const size = img.getSize()
      // 快速预判：短时间内尺寸相同的图片跳过（精确去重在 worker 中做）
      if (lastProcessTime && now - lastProcessTime < 2000 &&
          size.width === lastImageSize.width && size.height === lastImageSize.height) {
        return
      }
      lastImageSize = size
      lastProcessTime = now
      enqueue({
        type: 'image',
        image: img,
        sourcePromise: getForegroundSource(),
        capturedAt: now
      })
      return
    }

    const text = clipboard.readText()
    const normalized = normalizeText(text)
    if (normalized) {
      const hash = hashText(normalized)
      if (seenTextHashes.has(hash)) return
      seenTextHashes.add(hash)
      if (seenTextHashes.size > 1000) {
        const arr = [...seenTextHashes]
        arr.splice(0, 500)
        seenTextHashes.clear()
        arr.forEach(h => seenTextHashes.add(h))
      }
      lastProcessTime = now
      enqueue({
        type: 'text',
        content: normalized,
        sourcePromise: getForegroundSource(),
        capturedAt: now
      })
    }
  } catch (err) {
    // 剪贴板被其他进程锁定，忽略
  }
}

// ====== API ======

/**
 * 设置图片目录
 */
function setImageDir(dir) {
  imagesDir = dir
  fs.mkdirSync(path.join(dir, 'full'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'thumb'), { recursive: true })
}

/**
 * 从数据库加载已有哈希（启动时调用，防止重复）
 */
function loadFromDB(items) {
  for (const item of items) {
    if (item.type === 'text' && item.content) {
      const hash = hashText(normalizeText(item.content) || '')
      if (hash) seenTextHashes.add(hash)
    }
    // 图片哈希无法从 DB 还原（需要原始 PNG 数据），只能靠内容去重
  }
}

/**
 * 启动监听
 */
function start() {
  if (pollTimer) return
  pollTimer = setInterval(checkClipboard, POLL_INTERVAL)
  checkClipboard() // 立即检查一次
}

/**
 * 停止监听
 */
function stop() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * 跳过下一次检测（复制到剪贴板时使用）
 */
function skipNextCopy() {
  skipCount++
}

/**
 * 获取队列状态（调试用）
 */
function getStatus() {
  return {
    queueLength: queue.length,
    processing,
    seenTextCount: seenTextHashes.size,
    seenImageCount: seenImageHashes.size,
    lastProcessTime
  }
}

module.exports = {
  start,
  stop,
  setImageDir,
  skipNextCopy,
  getStatus,
  loadFromDB,
  _test: { normalizeText, hashText, processItem, enqueue, processQueue },
  setOptions
}

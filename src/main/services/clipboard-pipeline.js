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

// ====== Options（暂停监听 / 敏感内容保护） ======
let options = { pause: false, skipSensitive: true }

function setOptions(opts) {
  if (!opts) return
  if (typeof opts.pause === 'boolean') options.pause = opts.pause
  if (typeof opts.skipSensitive === 'boolean') options.skipSensitive = opts.skipSensitive
}

function isSensitive(text) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    /(mongodb|postgres|mysql):\/\/[^\s:@]+:[^\s:@]+@/,
    /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[ -]?(?:[0-9]{4}[ -]?){3}\b/
  ]
  return patterns.some(p => p.test(text))
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
  if (item.type === 'text') {
    // 发出事件，让 DB 和 UI 自己处理
    eventBus.emit(Events.CLIPBOARD_TEXT, {
      type: 'text',
      content: item.content,
      createTime: Date.now()
    })
  } else if (item.type === 'image') {
    // 保存图片（使用缓存的 PNG buffer 避免重复 toPNG()）
    const saved = saveImage(item.image, item.pngBuffer)
    if (!saved) return

    eventBus.emit(Events.CLIPBOARD_IMAGE, {
      type: 'image',
      content: saved.filename,
      filePath: saved.filePath,
      thumbPath: saved.thumbPath,
      createTime: Date.now(),
      fileSize: saved.fileSize,
      imageWidth: saved.width,
      imageHeight: saved.height
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
    if (options.pause) return
    if (skipCount > 0) {
      skipCount--
      return
    }

    const now = Date.now()

    // 优先检查图片
    const img = clipboard.readImage()
    if (img && !img.isEmpty()) {
      const buf = img.toPNG()
      const hash = hashBuffer(buf)
      if (seenImageHashes.has(hash)) return
      seenImageHashes.add(hash)
      // 限制 Set 大小，防止内存泄漏
      if (seenImageHashes.size > 500) {
        const arr = [...seenImageHashes]
        arr.splice(0, 250)
        seenImageHashes.clear()
        arr.forEach(h => seenImageHashes.add(h))
      }
      lastImageSize = img.getSize()
      lastProcessTime = now
      enqueue({ type: 'image', image: img, pngBuffer: buf })
      return
    }

    // 检查文字
    const text = clipboard.readText()
    const normalized = normalizeText(text)
    if (normalized) {
      if (options.skipSensitive && isSensitive(normalized)) return
      const hash = hashText(normalized)
      if (seenTextHashes.has(hash)) return
      seenTextHashes.add(hash)
      // 限制 Set 大小，防止内存泄漏
      if (seenTextHashes.size > 1000) {
        const arr = [...seenTextHashes]
        arr.splice(0, 500)
        seenTextHashes.clear()
        arr.forEach(h => seenTextHashes.add(h))
      }
      lastProcessTime = now
      enqueue({ type: 'text', content: normalized })
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
  _test: { normalizeText, hashText }
  ,
  setOptions
}

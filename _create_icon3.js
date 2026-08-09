const fs = require('fs')

// 创建 PNG 格式的 ICO（更好的透明度支持）
function createPNGICO() {
  // 简化的 PNG 编码器
  function createPNG(width, height, pixels) {
    // PNG 文件结构
    const chunks = []
    
    // IHDR chunk
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8  // bit depth
    ihdr[9] = 6  // color type: RGBA
    ihdr[10] = 0 // compression
    ihdr[11] = 0 // filter
    ihdr[12] = 0 // interlace
    chunks.push(createChunk('IHDR', ihdr))
    
    // IDAT chunk (raw pixel data with zlib)
    const rawData = []
    for (let y = 0; y < height; y++) {
      rawData.push(0) // filter type: none
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        rawData.push(pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3])
      }
    }
    
    const zlib = require('zlib')
    const compressed = zlib.deflateSync(Buffer.from(rawData))
    chunks.push(createChunk('IDAT', compressed))
    
    // IEND chunk
    chunks.push(createChunk('IEND', Buffer.alloc(0)))
    
    // 组合 PNG
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    return Buffer.concat([signature, ...chunks])
  }
  
  function createChunk(type, data) {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const typeBuffer = Buffer.from(type, 'ascii')
    const crc = crc32(Buffer.concat([typeBuffer, data]))
    const crcBuffer = Buffer.alloc(4)
    crc32
    crcBuffer.writeUInt32BE(crc, 0)
    return Buffer.concat([length, typeBuffer, data, crcBuffer])
  }
  
  // CRC32 实现
  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i]
      for (let j = 0; j < 8; j++) {
        if (crc & 1) {
          crc = (crc >>> 1) ^ 0xEDB88320
        } else {
          crc >>>= 1
        }
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  
  const sizes = [16, 32, 48, 64, 128, 256]
  const pngImages = []
  
  for (const size of sizes) {
    const pixels = Buffer.alloc(size * size * 4)
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4
        const cx = x / size
        const cy = y / size
        
        let r = 0, g = 0, b = 0, a = 0
        
        // 剪贴板形状
        const body = { left: 0.15, right: 0.85, top: 0.1, bottom: 0.9, radius: 0.1 }
        const clip = { left: 0.3, right: 0.7, top: 0.0, bottom: 0.2, radius: 0.05 }
        
        function inRoundRect(px, py, rect) {
          if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) return false
          const r = rect.radius
          const corners = [
            { x: rect.left + r, y: rect.top + r },
            { x: rect.right - r, y: rect.top + r },
            { x: rect.left + r, y: rect.bottom - r },
            { x: rect.right - r, y: rect.bottom - r }
          ]
          for (const corner of corners) {
            const dx = px - corner.x
            const dy = py - corner.y
            const inCornerX = px < rect.left + r || px > rect.right - r
            const inCornerY = py < rect.top + r || py > rect.bottom - r
            if (inCornerX && inCornerY && dx * dx + dy * dy > r * r) return false
          }
          return true
        }
        
        const inBody = inRoundRect(cx, cy, body)
        const inClip = inRoundRect(cx, cy, clip)
        
        if (inBody || inClip) {
          // 蓝紫渐变
          const t = cy
          r = Math.floor(90 + t * 50)
          g = Math.floor(100 + t * 40)
          b = Math.floor(180 + t * 50)
          a = 255
          
          // 夹子稍深
          if (inClip && !inBody) {
            r = Math.floor(r * 0.8)
            g = Math.floor(g * 0.8)
            b = Math.floor(b * 0.85)
          }
          
          // 内部横线
          if (inBody && cy > 0.25 && cy < 0.8) {
            const lineY = (cy - 0.25) % 0.13
            if (lineY < 0.05 && cx > 0.25 && cx < 0.65) {
              const blend = 0.3
              r = Math.floor(r + (240 - r) * blend)
              g = Math.floor(g + (245 - g) * blend)
              b = Math.floor(b + (255 - b) * blend)
            }
          }
          
          // 右下角小宠物
          const petX = 0.72, petY = 0.72, petR = 0.1
          const dx = cx - petX, dy = cy - petY
          if (dx * dx + dy * dy < petR * petR) {
            r = 255
            g = 190
            b = 210
            a = 255
          }
          
          // 边缘柔和
          const edge = Math.min(cx - body.left, body.right - cx, cy - body.top, body.bottom - cy)
          if (edge < 0.03 && edge >= 0) {
            const fade = edge / 0.03
            a = Math.floor(255 * Math.sqrt(fade))
          }
        }
        
        pixels[idx] = r
        pixels[idx + 1] = g
        pixels[idx + 2] = b
        pixels[idx + 3] = a
      }
    }
    
    pngImages.push(createPNG(size, size, pixels))
  }
  
  // ICO 文件头
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // ICO
  header.writeUInt16LE(sizes.length, 4)
  
  // 目录条目 + 图像数据
  const directory = Buffer.alloc(sizes.length * 16)
  let offset = 6 + sizes.length * 16
  
  for (let i = 0; i < sizes.length; i++) {
    const entry = directory.slice(i * 16, (i + 1) * 16)
    entry[0] = sizes[i] === 256 ? 0 : sizes[i]
    entry[1] = sizes[i] === 256 ? 0 : sizes[i]
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(pngImages[i].length, 8) // data size
    entry.writeUInt32LE(offset, 12) // data offset
    offset += pngImages[i].length
  }
  
  return Buffer.concat([header, directory, ...pngImages])
}

const ico = createPNGICO()
fs.writeFileSync('resources/icon.ico', ico)
console.log('Created PNG-based icon: ' + ico.length + ' bytes')

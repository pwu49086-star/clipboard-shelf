const fs = require('fs')

// 创建更精致的图标
function createBetterIcon() {
  const sizes = [16, 32, 48, 64, 128, 256]
  const images = []
  
  for (const size of sizes) {
    const pixels = Buffer.alloc(size * size * 4)
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4
        const cx = x / size  // 0-1
        const cy = y / size  // 0-1
        
        let r = 0, g = 0, b = 0, a = 0
        
        // 剪贴板主体 - 居中，带圆角
        const body = { left: 0.18, right: 0.82, top: 0.12, bottom: 0.88, radius: 0.08 }
        
        // 夹子 - 顶部
        const clip = { left: 0.32, right: 0.68, top: 0.02, bottom: 0.18, radius: 0.04 }
        
        // 检查是否在圆角矩形内
        function inRoundRect(px, py, rect) {
          if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) return false
          
          const r = rect.radius
          // 四个角
          const corners = [
            { x: rect.left + r, y: rect.top + r },
            { x: rect.right - r, y: rect.top + r },
            { x: rect.left + r, y: rect.bottom - r },
            { x: rect.right - r, y: rect.bottom - r }
          ]
          
          for (const corner of corners) {
            const dx = px - corner.x
            const dy = py - corner.y
            if ((px < corner.x - r || px > corner.x + r) && 
                (py < corner.y - r || py > corner.y + r)) {
              if (dx * dx + dy * dy > r * r) return false
            }
          }
          return true
        }
        
        const inBody = inRoundRect(cx, cy, body)
        const inClip = inRoundRect(cx, cy, clip)
        
        if (inBody || inClip) {
          // 主色调 - 温暖的蓝紫色渐变
          const gradient = cy / size
          r = Math.floor(100 + gradient * 40)  // 100-140
          g = Math.floor(120 + gradient * 30)   // 120-150
          b = Math.floor(200 + gradient * 30)   // 200-230
          a = 255
          
          // 夹子颜色稍深
          if (inClip) {
            r = Math.floor(r * 0.85)
            g = Math.floor(g * 0.85)
            b = Math.floor(b * 0.9)
          }
          
          // 内部线条 - 模拟文字内容
          if (inBody && cy > 0.28 && cy < 0.78) {
            const lineSpacing = 0.12
            const lineY = (cy - 0.28) % lineSpacing
            const lineWidth = 0.35
            const lineLeft = 0.28
            const lineRight = lineLeft + lineWidth
            
            if (lineY < 0.06 && cx > lineLeft && cx < lineRight) {
              // 渐变线条效果
              const lineAlpha = 1 - (lineY / 0.06)
              r = Math.floor(r + (255 - r) * 0.3 * lineAlpha)
              g = Math.floor(g + (255 - g) * 0.3 * lineAlpha)
              b = Math.floor(b + (255 - b) * 0.3 * lineAlpha)
            }
          }
          
          // 右下角小装饰 - 代表宠物
          if (inBody && cx > 0.65 && cx < 0.85 && cy > 0.65 && cy < 0.85) {
            const petCenterX = 0.75
            const petCenterY = 0.75
            const petRadius = 0.08
            const dx = cx - petCenterX
            const dy = cy - petCenterY
            const dist = Math.sqrt(dx * dx + dy * dy)
            
            if (dist < petRadius) {
              // 小宠物 - 可爱的粉色
              r = 255
              g = 180 + Math.floor(dist * 200)
              b = 200
              a = 255
            }
          }
          
          // 边缘阴影效果
          const edgeDist = Math.min(
            cx - body.left,
            body.right - cx,
            cy - body.top,
            body.bottom - cy
          )
          if (edgeDist < 0.05) {
            const shadow = edgeDist / 0.05
            r = Math.floor(r * shadow)
            g = Math.floor(g * shadow)
            b = Math.floor(b * shadow)
          }
        }
        
        pixels[idx] = r
        pixels[idx + 1] = g
        pixels[idx + 2] = b
        pixels[idx + 3] = a
      }
    }
    
    images.push({ size, data: pixels })
  }
  
  // ICO 文件头
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // ICO
  header.writeUInt16LE(images.length, 4)
  
  // 目录条目
  const directory = Buffer.alloc(images.length * 16)
  const imageDataBuffers = []
  let offset = 6 + images.length * 16
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const entry = directory.slice(i * 16, (i + 1) * 16)
    
    entry[0] = img.size === 256 ? 0 : img.size
    entry[1] = img.size === 256 ? 0 : img.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    
    const bmpSize = 40 + img.data.length + (img.size * img.size / 8)
    entry.writeUInt32LE(bmpSize, 8)
    entry.writeUInt32LE(offset, 12)
    
    offset += bmpSize
    
    // BITMAPINFOHEADER
    const bmpHeader = Buffer.alloc(40)
    bmpHeader.writeUInt32LE(40, 0)
    bmpHeader.writeInt32LE(img.size, 4)
    bmpHeader.writeInt32LE(img.size * 2, 8)
    bmpHeader.writeUInt16LE(1, 12)
    bmpHeader.writeUInt16LE(32, 14)
    bmpHeader.writeUInt32LE(0, 16)
    bmpHeader.writeUInt32LE(img.data.length, 20)
    
    imageDataBuffers.push(bmpHeader)
    imageDataBuffers.push(img.data)
    
    // AND mask
    const mask = Buffer.alloc(img.size * img.size / 8, 0)
    imageDataBuffers.push(mask)
  }
  
  return Buffer.concat([header, directory, ...imageDataBuffers])
}

const ico = createBetterIcon()
fs.writeFileSync('resources/icon.ico', ico)
console.log('Created better icon: resources/icon.ico (' + ico.length + ' bytes)')

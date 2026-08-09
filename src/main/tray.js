const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')
const fs = require('fs')

let tray = null

function createIcon() {
  // 创建一个简单的 16x16 深色托盘图标
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // 画一个简单的剪贴板形状
      const isBody = x >= 3 && x <= 12 && y >= 3 && y <= 14
      const isClip = x >= 5 && x <= 10 && y >= 1 && y <= 4
      const isLine1 = x >= 5 && x <= 10 && y >= 6 && y <= 6
      const isLine2 = x >= 5 && x <= 10 && y >= 8 && y <= 8
      const isLine3 = x >= 5 && x <= 10 && y >= 10 && y <= 10

      if (isBody || isClip) {
        const brightness = isLine1 || isLine2 || isLine3 ? 200 : 140
        canvas[i] = brightness     // R
        canvas[i + 1] = brightness // G
        canvas[i + 2] = brightness // B
        canvas[i + 3] = 255        // A
      } else {
        canvas[i + 3] = 0 // transparent
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function setup(mainWindow) {
  const iconPath = path.join(__dirname, '../../resources/icon.png')
  let icon
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath)
  } else {
    icon = createIcon()
  }

  tray = new Tray(icon)
  tray.setToolTip('Clipboard Shelf')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  return tray
}

module.exports = { setup }

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const SOURCE = path.join(__dirname, '..', 'src', 'main', 'ipc-handlers.js')

test('output:exportMarkdown IPC smoke: dialog is in scope', () => {
  const src = fs.readFileSync(SOURCE, 'utf8')

  // 顶层 electron 解构必须包含 dialog（P1 回归：dialog is not defined）
  const topRequire = src.match(/const \{([^}]+)\} = require\('electron'\)/)?.[1] || ''
  assert.ok(
    /\bdialog\b/.test(topRequire),
    'top-level electron destructure must include dialog'
  )

  // 导出 handler 必须注册且使用 dialog + shell.showItemInFolder
  assert.ok(src.includes("ipcMain.handle('output:exportMarkdown'"))
  assert.ok(src.includes('dialog.showSaveDialogSync'))
  assert.ok(src.includes('shell.showItemInFolder'))
})

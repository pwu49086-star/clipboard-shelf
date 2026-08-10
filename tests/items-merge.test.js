const test = require('node:test')
const assert = require('node:assert')

const { mergeItemIntoList } = require('../src/shared/items-merge.cjs')

test('merge prepends new item and keeps favorite-first order', () => {
  const fav = { id: 1, isFavorite: 1, createTime: 100 }
  const old = { id: 2, isFavorite: 0, createTime: 200 }
  let list = [old]
  list = mergeItemIntoList(list, fav)
  assert.deepStrictEqual(list.map(i => i.id), [1, 2])
})

test('merge replaces existing item by id', () => {
  const a = { id: 1, isFavorite: 0, createTime: 100, content: 'old' }
  const b = { id: 2, isFavorite: 0, createTime: 200 }
  let list = [a, b]
  list = mergeItemIntoList(list, { id: 1, isFavorite: 0, createTime: 100, content: 'new' })
  assert.strictEqual(list.length, 2)
  assert.strictEqual(list.find(i => i.id === 1).content, 'new')
})

test('incremental merge never truncates the list (slice(0,200) regression)', () => {
  let list = []
  for (let i = 1; i <= 250; i++) {
    list = mergeItemIntoList(list, { id: i, isFavorite: 0, createTime: i })
  }
  assert.strictEqual(list.length, 250, 'list must keep all 250 items, not converge to 200')
  // 最新（createTime 最大）在最前
  assert.strictEqual(list[0].id, 250)
  assert.strictEqual(list[249].id, 1)
})

test('merge sorts favorites before newer non-favorites', () => {
  const favOld = { id: 1, isFavorite: 1, createTime: 1 }
  const newNormal = { id: 2, isFavorite: 0, createTime: 9999 }
  let list = [newNormal]
  list = mergeItemIntoList(list, favOld)
  assert.deepStrictEqual(list.map(i => i.id), [1, 2])
})

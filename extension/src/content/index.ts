import { parseCurrentPage, isPropertyPage } from '../parsers'

// Content script が物件ページに inject された時の処理
;(async () => {
  if (!isPropertyPage()) return

  const property = parseCurrentPage()
  if (!property) {
    console.warn('[Bukken.io] Property parse failed on:', window.location.href)
    return
  }

  // Background service worker に物件データを送信
  chrome.runtime.sendMessage({
    type: 'PROPERTY_DETECTED',
    payload: property,
  })

  // サイドパネルを自動で開く（ユーザーが初めて来た場合のみ）
  const { autoOpen } = await chrome.storage.local.get('autoOpen')
  if (autoOpen !== false) {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
  }
})()

// Background からのメッセージを受信
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'REQUEST_PROPERTY') {
    const property = parseCurrentPage()
    chrome.runtime.sendMessage({
      type: 'PROPERTY_DETECTED',
      payload: property,
    })
  }
})

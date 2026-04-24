// Background Service Worker
// 物件データの受け渡し・サイドパネルの開閉を管理

import type { PropertyData } from '../../../shared/types'

// 現在のタブの物件データを保持
const tabPropertyMap = new Map<number, PropertyData>()

// メッセージハンドラ
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id

  switch (msg.type) {
    case 'PROPERTY_DETECTED': {
      if (tabId && msg.payload) {
        tabPropertyMap.set(tabId, msg.payload)
        // サイドパネルが開いていれば通知
        chrome.runtime.sendMessage({
          type: 'PROPERTY_UPDATED',
          payload: msg.payload,
          tabId,
        }).catch(() => {}) // サイドパネルが閉じていれば無視
      }
      break
    }

    case 'OPEN_SIDEPANEL': {
      if (tabId) {
        chrome.sidePanel.open({ tabId }).catch(console.error)
      }
      break
    }

    case 'GET_CURRENT_PROPERTY': {
      // サイドパネルが現在の物件データを要求
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTabId = tabs[0]?.id
        if (activeTabId) {
          const property = tabPropertyMap.get(activeTabId)
          sendResponse({ property: property ?? null })
        } else {
          sendResponse({ property: null })
        }
      })
      return true // async response
    }

    case 'AUTH_TOKEN': {
      // Magic Link 認証後、auth/callback ページからトークンを受信
      if (msg.token) {
        chrome.storage.local.set({ authToken: msg.token }, () => {
          // サイドパネルに認証完了を通知
          chrome.runtime.sendMessage({ type: 'AUTH_COMPLETED' }).catch(() => {})
        })
      }
      break
    }

    case 'LOGOUT': {
      chrome.storage.local.remove('authToken', () => {
        chrome.runtime.sendMessage({ type: 'AUTH_CLEARED' }).catch(() => {})
      })
      break
    }
  }
})

// ツールバーアイコンクリックでサイドパネルを開く
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error)
  }
})

// タブが閉じられたらクリーンアップ
chrome.tabs.onRemoved.addListener((tabId) => {
  tabPropertyMap.delete(tabId)
})

// タブのURLが変わったら再パース要求
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    tabPropertyMap.delete(tabId)
    chrome.tabs.sendMessage(tabId, { type: 'REQUEST_PROPERTY' }).catch(() => {})
  }
})

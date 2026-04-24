import type { PlasmoCSConfig } from "plasmo"
import { parseCurrentPage, isPropertyPage } from "../parsers"

export const config: PlasmoCSConfig = {
  matches: [
    "https://suumo.jp/ms/chuko/*",
    "https://suumo.jp/ms/shinchiku/*",
    "https://suumo.jp/jj/bukken/*",
    "https://suumo.jp/chintai/jj/*",
    "https://www.athome.co.jp/mansion/*",
    "https://www.athome.co.jp/kodate/*",
    "https://www.homes.co.jp/mansion/*",
    "https://www.homes.co.jp/kodate/*",
    "https://www.homes.co.jp/chintai/*",
    "https://www.rakumachi.jp/syuuekibukken/*",
    "https://www.kenbiya.com/ar/*",
    "https://www.kenbiya.com/pp*",  // pp3/pp4/pp5/... 全バージョン
  ],
  run_at: "document_idle",
}

;(async () => {
  if (!isPropertyPage()) return

  const property = parseCurrentPage()
  if (!property) {
    console.warn("[Bukken.io] パース失敗:", window.location.href)
    return
  }
  console.log("[Bukken.io] Parsed property:", property)

  // Background に物件データを送信
  chrome.runtime.sendMessage({ type: "PROPERTY_DETECTED", payload: property })

  // サイドパネルを自動で開く
  const { autoOpen } = await chrome.storage.local.get("autoOpen")
  if (autoOpen !== false) {
    chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" })
  }
})()

// Background からの再パース要求
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "REQUEST_PROPERTY") {
    const property = parseCurrentPage()
    chrome.runtime.sendMessage({ type: "PROPERTY_DETECTED", payload: property })
  }
})

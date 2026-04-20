"""
大島てる 事故物件チェッカー
==============================
ローカルで実行してテストするスクリプト。
Bukken.io バックエンドに組み込む前に動作確認用。

使い方:
    pip install requests beautifulsoup4
    python oshima_checker.py

大島てるのサイト構造:
    https://www.oshimaland.co.jp/
    
    検索URL例:
    https://www.oshimaland.co.jp/?q=東京都渋谷区恵比寿2-8-1
    
    地図ベースのサイトで、物件は地図上のピン（炎アイコン）として表示される。
    HTML ソースに物件データが JSON-like な形式で埋め込まれている。
"""

import requests
import re
import json
import time
from urllib.parse import quote
from dataclasses import dataclass
from typing import Optional

# ─── データ型 ─────────────────────────────────────────────────────────────────

@dataclass
class OshimaEntry:
    """大島てるの1件のエントリ"""
    address: str
    floor: Optional[str]       # 部屋番号・階数（あれば）
    cause: str                 # 死因（殺人、自殺、火災 等）
    detail: str                # 詳細テキスト
    url: str                   # 元URL

@dataclass
class OshimaResult:
    """チェック結果"""
    # 完全一致（同住所・同フロア）
    exact_match: bool
    exact_entries: list[OshimaEntry]
    
    # 同棟一致（マンション同棟・別フロア）
    same_building: bool
    same_building_entries: list[OshimaEntry]
    
    # 近隣（一戸建て向け：隣接住所）
    nearby: bool
    nearby_entries: list[OshimaEntry]
    
    # 物件種別
    property_type: str  # 'mansion' | 'house' | 'unknown'
    
    # 表示用メッセージ
    summary: str

# ─── メインロジック ────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept-Language": "ja-JP,ja;q=0.9",
    "Referer": "https://www.oshimaland.co.jp/",
}

def check_oshimaland(
    address: str,
    floor: Optional[str] = None,
    property_type: str = "mansion",  # 'mansion' | 'house'
    timeout: int = 10,
) -> OshimaResult:
    """
    大島てるで住所をチェックする
    
    Args:
        address: 住所（例: "東京都渋谷区恵比寿2-8-1"）
        floor: 階数・部屋番号（例: "305" or "3F"）
        property_type: 物件種別
        timeout: タイムアウト秒数
    """
    
    # ── 1. サイトから周辺データを取得 ────────────────────────────────────────
    entries = _fetch_entries(address, timeout)
    
    if entries is None:
        # 取得失敗
        return OshimaResult(
            exact_match=False,
            exact_entries=[],
            same_building=False,
            same_building_entries=[],
            nearby=False,
            nearby_entries=[],
            property_type=property_type,
            summary="大島てるへの接続に失敗しました",
        )
    
    if not entries:
        return OshimaResult(
            exact_match=False,
            exact_entries=[],
            same_building=False,
            same_building_entries=[],
            nearby=False,
            nearby_entries=[],
            property_type=property_type,
            summary="事故物件の登録なし",
        )
    
    # ── 2. 住所を正規化して比較 ───────────────────────────────────────────────
    norm_address = _normalize_address(address)
    
    exact_entries = []
    same_building_entries = []
    nearby_entries = []
    
    for entry in entries:
        norm_entry = _normalize_address(entry.address)
        
        # 完全一致チェック（住所 + フロア）
        if norm_entry == norm_address:
            if floor and entry.floor:
                # 両方フロア情報がある場合は階数も比較
                if _normalize_floor(floor) == _normalize_floor(entry.floor):
                    exact_entries.append(entry)
                else:
                    same_building_entries.append(entry)
            else:
                # フロア情報なし → 住所一致で exact 扱い
                exact_entries.append(entry)
        
        # 同棟チェック（マンション：住所が含まれる）
        elif property_type == "mansion" and (
            norm_address in norm_entry or norm_entry in norm_address
        ):
            same_building_entries.append(entry)
        
        # 近隣チェック（一戸建て：番地が±2以内）
        elif property_type == "house":
            if _is_nearby_address(norm_address, norm_entry):
                nearby_entries.append(entry)
    
    # ── 3. サマリー生成 ───────────────────────────────────────────────────────
    summary = _build_summary(
        exact_entries, same_building_entries, nearby_entries, property_type
    )
    
    return OshimaResult(
        exact_match=len(exact_entries) > 0,
        exact_entries=exact_entries,
        same_building=len(same_building_entries) > 0,
        same_building_entries=same_building_entries,
        nearby=len(nearby_entries) > 0,
        nearby_entries=nearby_entries,
        property_type=property_type,
        summary=summary,
    )


def _fetch_entries(address: str, timeout: int) -> Optional[list[OshimaEntry]]:
    """大島てるから住所周辺のエントリを取得"""
    try:
        # 検索URL
        url = f"https://www.oshimaland.co.jp/?q={quote(address)}"
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
        resp.encoding = "utf-8"
        
        return _parse_oshimaland_html(resp.text, url)
    
    except requests.exceptions.RequestException as e:
        print(f"[Oshima] Fetch error: {e}")
        return None


def _parse_oshimaland_html(html: str, base_url: str) -> list[OshimaEntry]:
    """
    大島てるの HTML から事故物件エントリを抽出
    
    サイト構造の調査結果：
    - 地図ベースの UI で、物件データは JavaScript 変数 or JSON として埋め込まれている
    - <script> タグ内に "var locations = [...]" 形式でデータが存在
    - 各エントリに address, floor, cause, detail が含まれる
    """
    entries = []
    
    # パターン1: JavaScript 変数として埋め込まれているケース
    # var locations = [{...}, {...}]
    js_pattern = re.search(
        r'var\s+locations\s*=\s*(\[.*?\]);',
        html, re.DOTALL
    )
    if js_pattern:
        try:
            data = json.loads(js_pattern.group(1))
            for item in data:
                entries.append(OshimaEntry(
                    address=item.get("address", ""),
                    floor=item.get("floor") or item.get("room"),
                    cause=item.get("cause", "不明"),
                    detail=item.get("detail", ""),
                    url=base_url,
                ))
            return entries
        except json.JSONDecodeError:
            pass
    
    # パターン2: data 属性に埋め込まれているケース
    # <div class="marker" data-address="..." data-cause="...">
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    
    markers = soup.find_all(attrs={"data-address": True})
    for marker in markers:
        entries.append(OshimaEntry(
            address=marker.get("data-address", ""),
            floor=marker.get("data-floor") or marker.get("data-room"),
            cause=marker.get("data-cause", "不明"),
            detail=marker.get("data-detail", ""),
            url=base_url,
        ))
    
    if entries:
        return entries
    
    # パターン3: テーブル形式で列挙されているケース
    table = soup.find("table", class_=re.compile(r"bukken|jiko|list"))
    if table:
        rows = table.find_all("tr")[1:]  # ヘッダースキップ
        for row in rows:
            cols = row.find_all("td")
            if len(cols) >= 2:
                entries.append(OshimaEntry(
                    address=cols[0].get_text(strip=True),
                    floor=cols[1].get_text(strip=True) if len(cols) > 2 else None,
                    cause=cols[-1].get_text(strip=True),
                    detail="",
                    url=base_url,
                ))
    
    # パターン4: JSON-LD
    json_ld = soup.find("script", type="application/ld+json")
    if json_ld:
        try:
            data = json.loads(json_ld.string)
            if isinstance(data, list):
                for item in data:
                    if "address" in item:
                        entries.append(OshimaEntry(
                            address=item.get("address", ""),
                            floor=None,
                            cause=item.get("cause", "不明"),
                            detail=item.get("description", ""),
                            url=base_url,
                        ))
        except (json.JSONDecodeError, AttributeError):
            pass
    
    return entries


# ─── ユーティリティ ───────────────────────────────────────────────────────────

def _normalize_address(address: str) -> str:
    """住所を正規化（全角数字→半角、ハイフン統一）"""
    # 全角数字 → 半角
    trans = str.maketrans("０１２３４５６７８９", "0123456789")
    address = address.translate(trans)
    # 全角ハイフン・中点を半角に
    address = address.replace("－", "-").replace("ー", "-").replace("−", "-").replace("・", "-")
    # スペース除去
    address = address.replace(" ", "").replace("　", "")
    # 丁目・番・号 → ハイフン
    address = re.sub(r"丁目", "-", address)
    address = re.sub(r"番地?", "-", address)
    address = re.sub(r"号$", "", address)
    return address.strip()


def _normalize_floor(floor: str) -> str:
    """階数・部屋番号を正規化"""
    trans = str.maketrans("０１２３４５６７８９", "0123456789")
    floor = floor.translate(trans)
    # 「3F」「3階」「305号室」等を数字のみに
    floor = re.sub(r"[Ff階号室]", "", floor)
    return floor.strip()


def _is_nearby_address(addr1: str, addr2: str, range: int = 2) -> bool:
    """
    一戸建て向け：番地が±range以内かチェック
    例: "渋谷2-8-1" と "渋谷2-8-3" → range=2 なら True
    """
    # 最後の番地数字を抽出
    num1 = re.findall(r"\d+", addr1)
    num2 = re.findall(r"\d+", addr2)
    
    if not num1 or not num2:
        return False
    
    # 丁目・番が一致し、号が±range以内
    if len(num1) >= 3 and len(num2) >= 3:
        if num1[0] == num2[0] and num1[1] == num2[1]:
            try:
                return abs(int(num1[2]) - int(num2[2])) <= range
            except ValueError:
                return False
    
    return False


def _build_summary(
    exact: list, same_building: list, nearby: list, prop_type: str
) -> str:
    if exact:
        causes = "、".join(set(e.cause for e in exact))
        floors = "、".join(filter(None, [e.floor for e in exact]))
        floor_str = f"（{floors}）" if floors else ""
        return f"⚠️ この物件{floor_str}は大島てるに登録あり：{causes}"
    
    if same_building and prop_type == "mansion":
        causes = "、".join(set(e.cause for e in same_building))
        floors = "、".join(filter(None, [e.floor for e in same_building]))
        floor_str = f"（{floors}）" if floors else "（別室）"
        return f"⚠️ 同棟の別室{floor_str}に事故物件登録あり：{causes}"
    
    if nearby and prop_type == "house":
        return f"ℹ️ 近隣（{len(nearby)}件）に事故物件登録あり"
    
    return "✅ 大島てるへの登録なし"


# ─── テスト実行 ───────────────────────────────────────────────────────────────

def run_test():
    """テストケース（実際の住所でテストしてください）"""
    
    test_cases = [
        # (住所, 階数, 物件種別)
        ("東京都渋谷区恵比寿2-8-1", "305", "mansion"),
        ("東京都新宿区歌舞伎町1-1-1", None, "mansion"),
        ("東京都世田谷区太子堂2-14-3", None, "house"),
    ]
    
    print("=" * 60)
    print("大島てる 事故物件チェッカー テスト")
    print("=" * 60)
    
    for address, floor, prop_type in test_cases:
        print(f"\n📍 {address} {'F'+floor if floor else ''} [{prop_type}]")
        
        result = check_oshimaland(address, floor, prop_type)
        print(f"   {result.summary}")
        
        if result.exact_entries:
            for e in result.exact_entries:
                print(f"   [完全一致] {e.floor or ''} {e.cause}: {e.detail[:50]}")
        
        if result.same_building_entries:
            for e in result.same_building_entries:
                print(f"   [同棟別室] {e.floor or ''} {e.cause}")
        
        if result.nearby_entries:
            for e in result.nearby_entries:
                print(f"   [近隣] {e.address} {e.cause}")
        
        time.sleep(2)  # レート制限


if __name__ == "__main__":
    run_test()

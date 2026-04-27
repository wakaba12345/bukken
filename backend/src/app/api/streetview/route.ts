/**
 * GET /api/streetview
 * ====================
 * Google Street View Static API のプロキシ。
 * 前端から GOOGLE_MAPS_API_KEY を露出させずに Street View 画像を表示するため。
 *
 * クエリ:
 *   lat, lng        必須（座標）
 *   heading         省略時 0（0-360）
 *   pitch           省略時 0（-90 to 90）
 *   fov             省略時 90（10-120）
 *   size            省略時 640x640（最大 640x640、Street View Static API 制限）
 *
 * レスポンス:
 *   200: image/jpeg バイト
 *   400: 無効なパラメータ
 *   501: GOOGLE_MAPS_API_KEY 未設定
 *
 * Cache-Control: 30 日（Street View 画像は基本不変、CDN/ブラウザでキャッシュ）
 */

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const SIZE_PATTERN = /^(\d{1,4})x(\d{1,4})$/

export async function GET(req: NextRequest) {
  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY
  if (!GOOGLE_KEY) {
    return new NextResponse('GOOGLE_MAPS_API_KEY 未設定', { status: 501 })
  }

  const { searchParams } = new URL(req.url)
  const lat = searchParams.get('lat')
  const lng = searchParams.get('lng')
  const heading = searchParams.get('heading') ?? '0'
  const pitch = searchParams.get('pitch') ?? '0'
  const fov = searchParams.get('fov') ?? '90'
  const size = searchParams.get('size') ?? '640x640'

  if (!lat || !lng) {
    return new NextResponse('lat と lng が必須', { status: 400 })
  }

  // 入力検証（abuse prevention）
  const latNum = parseFloat(lat)
  const lngNum = parseFloat(lng)
  if (
    !isFinite(latNum) || !isFinite(lngNum) ||
    Math.abs(latNum) > 90 || Math.abs(lngNum) > 180
  ) {
    return new NextResponse('座標が無効', { status: 400 })
  }

  const headingNum = parseFloat(heading)
  if (!isFinite(headingNum) || headingNum < 0 || headingNum > 360) {
    return new NextResponse('heading は 0-360', { status: 400 })
  }

  const pitchNum = parseFloat(pitch)
  if (!isFinite(pitchNum) || pitchNum < -90 || pitchNum > 90) {
    return new NextResponse('pitch は -90 から 90', { status: 400 })
  }

  const fovNum = parseFloat(fov)
  if (!isFinite(fovNum) || fovNum < 10 || fovNum > 120) {
    return new NextResponse('fov は 10-120', { status: 400 })
  }

  const sizeMatch = SIZE_PATTERN.exec(size)
  if (!sizeMatch) {
    return new NextResponse('size は WxH 形式（例: 640x640）', { status: 400 })
  }
  const w = parseInt(sizeMatch[1], 10)
  const h = parseInt(sizeMatch[2], 10)
  if (w > 640 || h > 640 || w < 16 || h < 16) {
    return new NextResponse('size の最大は 640x640、最小は 16x16', { status: 400 })
  }

  // Google Street View Static API
  const upstream = new URL('https://maps.googleapis.com/maps/api/streetview')
  upstream.searchParams.set('size', `${w}x${h}`)
  upstream.searchParams.set('location', `${latNum},${lngNum}`)
  upstream.searchParams.set('heading', String(headingNum))
  upstream.searchParams.set('pitch', String(pitchNum))
  upstream.searchParams.set('fov', String(fovNum))
  upstream.searchParams.set('key', GOOGLE_KEY)

  const res = await fetch(upstream.toString(), {
    next: { revalidate: 2592000 }, // 30 日
  })
  if (!res.ok) {
    return new NextResponse(
      `Street View fetch failed: ${res.status} ${res.statusText}`,
      { status: res.status === 403 ? 502 : res.status },
    )
  }

  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  if (!contentType.startsWith('image/')) {
    return new NextResponse('Upstream returned non-image', { status: 502 })
  }

  const body = await res.arrayBuffer()

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Street View 画像は基本不変、長期キャッシュ
      'Cache-Control': 'public, max-age=2592000, immutable',
    },
  })
}

import type { Platform, PropertyData } from '../../../shared/types'
import { parseSuumo } from './suumo'
import { parseAthome } from './athome'
import { parseHomes } from './homes'
import { parseRakumachi } from './rakumachi'
import { parseKenbiya } from './kenbiya'

export function detectPlatform(): Platform {
  const host = window.location.hostname
  if (host.includes('suumo.jp'))      return 'suumo'
  if (host.includes('athome.co.jp'))  return 'athome'
  if (host.includes('homes.co.jp'))   return 'homes'
  if (host.includes('rakumachi.jp'))  return 'rakumachi'
  if (host.includes('kenbiya.com'))   return 'kenbiya'
  return 'unknown'
}

export function parseCurrentPage(): PropertyData | null {
  const platform = detectPlatform()
  switch (platform) {
    case 'suumo':     return parseSuumo()
    case 'athome':    return parseAthome()
    case 'homes':     return parseHomes()
    case 'rakumachi': return parseRakumachi()
    case 'kenbiya':   return parseKenbiya()
    default:          return null
  }
}

export function isPropertyPage(): boolean {
  const platform = detectPlatform()
  const path = window.location.pathname

  if (platform === 'suumo') {
    return (
      path.includes('/ms/chuko/') ||
      path.includes('/ms/shinchiku/') ||
      path.includes('/jj/bukken/') ||
      path.includes('/chintai/jj/')
    )
  }
  if (platform === 'athome') {
    return path.includes('/mansion/') || path.includes('/kodate/')
  }
  if (platform === 'homes') {
    return (
      path.includes('/mansion/b-') ||
      path.includes('/kodate/b-') ||
      path.includes('/chintai/b-')
    )
  }
  if (platform === 'rakumachi') {
    return path.includes('/syuuekibukken/')
  }
  if (platform === 'kenbiya') {
    return path.includes('/ar/cl/') || path.includes('/ar/ns/')
  }
  return false
}

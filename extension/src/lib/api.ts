import type {
  ApiResponse,
  CrossPlatformResult,
  FeatureKey,
  PropertyData,
  ReportContent,
  UserProfile,
} from '../../../shared/types'

const BASE_URL = process.env.PLASMO_PUBLIC_API_URL ?? 'https://api.bukken.io'

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiResponse<T>> {
  const token = await getAuthToken()

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  const data = await res.json()
  return data as ApiResponse<T>
}

// ─── Auth token from storage ──────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  try {
    if (chrome?.storage?.local) {
      const { authToken } = await chrome.storage.local.get('authToken')
      return authToken ?? null
    }
  } catch {}
  return localStorage.getItem('bukken_auth_token')
}

export async function setAuthToken(token: string): Promise<void> {
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ authToken: token })
      return
    }
  } catch {}
  localStorage.setItem('bukken_auth_token', token)
}

export async function clearAuthToken(): Promise<void> {
  try {
    if (chrome?.storage?.local) {
      await chrome.storage.local.remove('authToken')
    }
  } catch {}
  localStorage.removeItem('bukken_auth_token')
}

// ─── User ─────────────────────────────────────────────────────────────────────

export async function getMe(): Promise<ApiResponse<UserProfile>> {
  return apiFetch<UserProfile>('/api/user/me')
}

// ─── Cross platform search ────────────────────────────────────────────────────

export async function searchCrossPlatform(
  property: PropertyData,
): Promise<ApiResponse<CrossPlatformResult>> {
  // route expects { source } not { property }
  return apiFetch<CrossPlatformResult>('/api/search/cross-platform', {
    method: 'POST',
    body: JSON.stringify({ source: property }),
  })
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function createReport(
  property: PropertyData,
  type: FeatureKey,
): Promise<ApiResponse<ReportContent>> {
  return apiFetch<ReportContent>('/api/report/create', {
    method: 'POST',
    body: JSON.stringify({ property, type }),
  })
}

export async function getReport(
  reportId: string,
): Promise<ApiResponse<ReportContent>> {
  return apiFetch<ReportContent>(`/api/report/${reportId}`)
}

// ─── Points ───────────────────────────────────────────────────────────────────

export async function getPointBalance(): Promise<ApiResponse<{ balance: number }>> {
  return apiFetch<{ balance: number }>('/api/points/balance')
}

export async function purchasePoints(
  planId: string,
): Promise<ApiResponse<{ checkoutUrl: string }>> {
  return apiFetch<{ checkoutUrl: string }>('/api/points/purchase', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  })
}

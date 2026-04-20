import type { NextConfig } from 'next'

const corsHeaders = [
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
]

// Chrome Extension からのリクエストを許可
const nextConfig: NextConfig = {
  headers: async () => [
    { source: '/api/:path*', headers: corsHeaders },
  ],
}

export default nextConfig

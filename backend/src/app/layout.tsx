import type { Metadata } from 'next'
import { Noto_Sans_JP } from 'next/font/google'

const notoSansJp = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-noto',
})

export const metadata: Metadata = {
  title: 'Bukken.io — 日本不動産アナライザー',
  description: '日本の不動産物件をリアルタイムで分析。クロスプラットフォーム価格比較・AI分析レポート・災害リスク情報を提供します。',
  metadataBase: new URL('https://bukken.io'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={notoSansJp.variable}>
      <body style={{ margin: 0, padding: 0, fontFamily: 'var(--font-noto), "PingFang TC", sans-serif' }}>
        {children}
      </body>
    </html>
  )
}

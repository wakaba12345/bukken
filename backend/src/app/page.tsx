import { redirect } from 'next/navigation'

// ルートは pricing ページにリダイレクト
// 官網 (website/index.html) は別の静的サイトとしてデプロイ
export default function Home() {
  redirect('/pricing')
}

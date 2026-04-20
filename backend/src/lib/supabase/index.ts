import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Service role client（バックエンドのみ）
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Points helpers ───────────────────────────────────────────────────────────

export async function getPointBalance(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('point_accounts')
    .select('balance')
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return data?.balance ?? 0
}

export async function deductPoints(
  userId: string,
  points: number,
  feature: string,
  propertyId?: string,
): Promise<void> {
  // Atomic deduction via RPC（残高チェック + 扣除 in one transaction）
  const { error } = await supabase.rpc('deduct_points', {
    p_user_id: userId,
    p_points: points,
    p_feature: feature,
    p_property_id: propertyId ?? null,
  })

  if (error) {
    if (error.message.includes('insufficient')) {
      throw new Error('INSUFFICIENT_POINTS')
    }
    throw error
  }
}

export async function addPoints(
  userId: string,
  points: number,
  planId: string,
): Promise<void> {
  const { error } = await supabase.rpc('add_points', {
    p_user_id: userId,
    p_points: points,
    p_plan_id: planId,
  })
  if (error) throw error
}

/**
 * e-Stat（政府統計の総合窓口）API モジュール
 * ===========================================
 * APIキー（appId）の申請（無料・即時発行）:
 *   https://www.e-stat.go.jp/mypage/user/preregister
 *   .env.local に ESTAT_APP_ID=xxx を設定
 *
 * 指標別にサブモジュールを分ける：
 *   population.ts       人口（令和2年国勢調査）
 *   populationMove.ts   人口移動（住民基本台帳、Phase 1.2 予定）
 *   housing.ts          空家率・総住宅数（住宅土地統計、Phase 1.3 予定）
 *   construction.ts     建築着工（Phase 1.4 予定）
 *   household.ts        家計調査（Phase 2.1 予定）
 *   foreignResidents.ts 在留外国人（Phase 4.1 予定）
 *
 * 現状の対応エリア: 東京23区 + 多摩7市 + 政令市 9つ（横浜・川崎・大阪・名古屋・
 * 札幌・京都・神戸・福岡 + 相模原 etc 随時追加）。対応外エリアは null 返却。
 */

export { resolveArea, type ResolvedArea } from './areaCodeResolver'
export { isEstatEnabled } from './client'

export { getAreaDemographics, type AreaDemographics } from './population'
export { getPopulationMovement, type PopulationMovement } from './populationMove'
export { getHousingConstruction, type HousingConstruction } from './construction'
export { getHousingVacancy, type HousingVacancy } from './housing'
export { getForeignResidents, type ForeignResidents } from './foreignResidents'
export { getEmploymentIncome, type EmploymentIncome } from './employment'

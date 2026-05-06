/** 移動対象のテキストブロック */
export interface TextBlock {
  /** ドキュメント内の開始位置（文字オフセット） */
  from: number;
  /** ドキュメント内の終了位置（文字オフセット） */
  to: number;
  /** ブロックのテキスト内容 */
  text: string;
}

/** 移動単位の種類 */
export type MoveUnit = 'line' | 'indent' | 'heading';

/** プラグイン設定 */
export interface TouchReorderSettings {
  /** 移動単位 */
  moveUnit: MoveUnit;
  /** 長押し判定のしきい値（ミリ秒） */
  longPressMs: number;
  /** 長押し中に指がこのピクセル数以上動いたら掴みをキャンセルする */
  moveCancelPx: number;
  /** 行頭からこのピクセル数以内のタッチのみ長押しを受け付ける */
  grabZonePx: number;
  /** バイブレーションの ON/OFF */
  vibration: boolean;
  /** ガイドラインの色（CSS カラー値。空文字の場合はアクセントカラーを使用） */
  guidelineColor: string;
}

/** デフォルト設定 */
export const DEFAULT_SETTINGS: TouchReorderSettings = {
  moveUnit: 'line',
  longPressMs: 300,
  moveCancelPx: 20,
  grabZonePx: 50,
  vibration: true,
  guidelineColor: '',
};

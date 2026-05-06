import { App, PluginSettingTab, Setting } from 'obsidian';
import type TouchReorderPlugin from './main';
import type { MoveUnit } from './types';

export class TouchReorderSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TouchReorderPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Touch Reorder 設定' });

    // 移動単位
    new Setting(containerEl)
      .setName('移動単位')
      .setDesc('ドラッグ時に選択されるブロックの単位を選びます。')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('line', '行')
          .addOption('indent', 'インデント（親+子要素）')
          .addOption('heading', 'ブロック（見出し配下）')
          .setValue(this.plugin.settings.moveUnit)
          .onChange(async (value) => {
            this.plugin.settings.moveUnit = value as MoveUnit;
            await this.plugin.saveSettings();
          }),
      );

    // 長押し時間
    new Setting(containerEl)
      .setName('長押し時間 (ms)')
      .setDesc('ドラッグを開始するまでの長押し時間（50〜800ms）')
      .addSlider((slider) =>
        slider
          .setLimits(50, 800, 50)
          .setValue(this.plugin.settings.longPressMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.longPressMs = value;
            await this.plugin.saveSettings();
          }),
      );

    // 掴みキャンセル距離
    new Setting(containerEl)
      .setName('掴みキャンセル距離 (px)')
      .setDesc('長押し中に指がこのピクセル数以上動いたら掴みをキャンセルします（5〜50px）')
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 5)
          .setValue(this.plugin.settings.moveCancelPx)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.moveCancelPx = value;
            await this.plugin.saveSettings();
          }),
      );
    // 掴みエリア幅
    new Setting(containerEl)
      .setName('掴みエリア幅 (px)')
      .setDesc('行頭からこのピクセル数以内のタッチのみドラッグを受け付けます（20〜200px）')
      .addSlider((slider) =>
        slider
          .setLimits(20, 200, 10)
          .setValue(this.plugin.settings.grabZonePx)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.grabZonePx = value;
            await this.plugin.saveSettings();
          }),
      );
    // バイブレーション
    new Setting(containerEl)
      .setName('バイブレーション')
      .setDesc('ドラッグ開始時に端末を振動させます（対応端末のみ）。')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.vibration)
          .onChange(async (value) => {
            this.plugin.settings.vibration = value;
            await this.plugin.saveSettings();
          }),
      );

    // ガイドラインカラー
    new Setting(containerEl)
      .setName('ガイドラインカラー')
      .setDesc('ドロップ先のガイドライン色（空欄でアクセントカラーを使用）')
      .addText((text) =>
        text
          .setPlaceholder('例: #ff6600')
          .setValue(this.plugin.settings.guidelineColor)
          .onChange(async (value) => {
            this.plugin.settings.guidelineColor = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}

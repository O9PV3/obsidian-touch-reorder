import { Plugin, Platform } from 'obsidian';
import { createTouchExtension } from './touchHandler';
import { TouchReorderSettingTab } from './settings';
import { DEFAULT_SETTINGS, type TouchReorderSettings } from './types';

export default class TouchReorderPlugin extends Plugin {
  settings: TouchReorderSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TouchReorderSettingTab(this.app, this));

    // モバイル端末でのみタッチハンドラーを登録
    if (Platform.isMobile) {
      this.registerEditorExtension(
        createTouchExtension(() => this.settings),
      );
    }
  }

  onunload() {
    // ViewPlugin.destroy() で自動クリーンアップされる
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

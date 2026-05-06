"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TouchReorderPlugin2
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/touchHandler.ts
var import_view = require("@codemirror/view");

// src/blockDetector.ts
var import_language = require("@codemirror/language");
function getLineBlock(view, pos) {
  const line = view.state.doc.lineAt(pos);
  return {
    from: line.from,
    to: line.to,
    text: line.text
  };
}
function getIndentLevel(lineText) {
  let level = 0;
  for (const ch of lineText) {
    if (ch === " ")
      level += 1;
    else if (ch === "	")
      level += 4;
    else
      break;
  }
  return level;
}
function getHeadingLevel(lineText) {
  const match = lineText.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}
function getIndentBlock(view, pos) {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const headingLv = getHeadingLevel(line.text);
  let toLine = line.number;
  if (headingLv > 0) {
    for (let i = line.number + 1; i <= doc.lines; i++) {
      const next = doc.line(i);
      const nextHeadingLv = getHeadingLevel(next.text);
      if (nextHeadingLv > 0 && nextHeadingLv <= headingLv)
        break;
      toLine = i;
    }
  } else {
    const baseIndent = getIndentLevel(line.text);
    for (let i = line.number + 1; i <= doc.lines; i++) {
      const next = doc.line(i);
      if (next.text.trim() === "")
        break;
      if (getIndentLevel(next.text) <= baseIndent)
        break;
      toLine = i;
    }
  }
  const from = line.from;
  const to = doc.line(toLine).to;
  return {
    from,
    to,
    text: doc.sliceString(from, to)
  };
}
function getHeadingBlock(view, pos) {
  const state = view.state;
  const tree = (0, import_language.syntaxTree)(state);
  const doc = state.doc;
  let headingFrom = -1;
  let headingLevel = 0;
  tree.iterate({
    enter(node) {
      const match = node.type.name.match(/^ATXHeading(\d)$/);
      if (match) {
        const level = parseInt(match[1], 10);
        if (node.from <= pos) {
          headingFrom = node.from;
          headingLevel = level;
        }
      }
    }
  });
  if (headingFrom < 0)
    return null;
  let blockEnd = doc.length;
  let found = false;
  tree.iterate({
    from: headingFrom + 1,
    enter(node) {
      if (found)
        return false;
      const match = node.type.name.match(/^ATXHeading(\d)$/);
      if (match) {
        const nextLevel = parseInt(match[1], 10);
        if (nextLevel <= headingLevel && node.from > headingFrom) {
          const prevLine = doc.lineAt(node.from);
          blockEnd = prevLine.number > 1 ? doc.line(prevLine.number - 1).to : node.from;
          found = true;
          return false;
        }
      }
    }
  });
  return {
    from: headingFrom,
    to: blockEnd,
    text: doc.sliceString(headingFrom, blockEnd)
  };
}

// src/touchHandler.ts
var _TouchReorderPlugin = class _TouchReorderPlugin {
  constructor(view, getSettings) {
    this.view = view;
    this.longPressTimer = null;
    this.drag = null;
    /** touchstart の座標（移動量チェック用） */
    this.startX = 0;
    this.startY = 0;
    /** 自動スクロール用 */
    this.autoScrollRAF = null;
    this.lastTouchY = 0;
    // ドラッグソースを示す CSS class の付与先
    this.sourceLines = [];
    /** ドラッグハンドル要素（左・右） */
    this.handles = [];
    // ──────────── touchstart ────────────
    this.onTouchStart = (e) => {
      if (e.touches.length !== 1)
        return;
      const target = e.target;
      if (!this.handles.length || !this.handles.some((h) => target === h || h.contains(target)))
        return;
      e.preventDefault();
      const touch = e.touches[0];
      this.startX = touch.clientX;
      this.startY = touch.clientY;
      const cursorPos = this.view.state.selection.main.head;
      this.longPressTimer = setTimeout(() => {
        this.startDrag(cursorPos);
      }, this.settings.longPressMs);
    };
    // ──────────── touchmove ────────────
    this.onTouchMove = (e) => {
      const touch = e.touches[0];
      if (this.longPressTimer && !this.drag) {
        const dx = touch.clientX - this.startX;
        const dy = touch.clientY - this.startY;
        if (Math.sqrt(dx * dx + dy * dy) > this.settings.moveCancelPx) {
          this.clearTimer();
        }
        return;
      }
      if (!this.drag)
        return;
      e.preventDefault();
      this.lastTouchY = touch.clientY;
      this.updateDropFromTouch(touch.clientX, touch.clientY);
      this.startAutoScroll();
    };
    // ──────────── touchend ────────────
    this.onTouchEnd = (_e) => {
      this.clearTimer();
      if (!this.drag)
        return;
      const { block, dropPos } = this.drag;
      this.cleanupDrag();
      if (dropPos == null)
        return;
      if (dropPos >= block.from && dropPos <= block.to)
        return;
      this.moveBlock(block, dropPos);
    };
    // ──────────── touchcancel ────────────
    this.onTouchCancel = () => {
      this.cancelDrag();
    };
    this.getSettings = getSettings;
    this.settings = getSettings();
    this.view.dom.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.view.dom.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.view.dom.addEventListener("touchend", this.onTouchEnd, { passive: true });
    this.view.dom.addEventListener("touchcancel", this.onTouchCancel, { passive: true });
    this.createHandle();
    this.updateHandlePosition();
  }
  update(update) {
    this.settings = this.getSettings();
    if (update.selectionSet || update.geometryChanged || update.docChanged) {
      this.updateHandlePosition();
    }
  }
  destroy() {
    this.cancelDrag();
    this.handles.forEach((h) => h.remove());
    this.handles = [];
    this.view.dom.removeEventListener("touchstart", this.onTouchStart);
    this.view.dom.removeEventListener("touchmove", this.onTouchMove);
    this.view.dom.removeEventListener("touchend", this.onTouchEnd);
    this.view.dom.removeEventListener("touchcancel", this.onTouchCancel);
  }
  // ──────────── ドラッグハンドル ────────────
  createHandle() {
    const makeHandle = (side) => {
      const handle = document.createElement("div");
      handle.className = `touch-reorder-handle touch-reorder-handle--${side}`;
      handle.setAttribute("aria-label", "\u884C\u3092\u79FB\u52D5");
      handle.textContent = "\u283F";
      this.view.dom.appendChild(handle);
      return handle;
    };
    this.handles = [makeHandle("left"), makeHandle("right")];
  }
  updateHandlePosition() {
    if (!this.handles.length || this.drag)
      return;
    const cursor = this.view.state.selection.main.head;
    const lineBlock = this.view.lineBlockAt(cursor);
    const coords = this.view.coordsAtPos(lineBlock.from);
    if (!coords) {
      this.handles.forEach((h) => h.style.display = "none");
      return;
    }
    const editorRect = this.view.dom.getBoundingClientRect();
    this.handles.forEach((h) => {
      h.style.display = "flex";
      h.style.top = `${coords.top - editorRect.top}px`;
      h.style.height = `${lineBlock.height}px`;
    });
  }
  // ──────────── ドラッグ開始 ────────────
  startDrag(pos) {
    this.clearTimer();
    const block = this.detectBlock(pos);
    if (!block)
      return;
    const sel = window.getSelection();
    if (sel)
      sel.removeAllRanges();
    this.view.dom.style.userSelect = "none";
    this.view.dom.style.webkitUserSelect = "none";
    if (this.settings.vibration && navigator.vibrate) {
      navigator.vibrate(50);
    }
    const indicator = document.createElement("div");
    indicator.className = "touch-reorder-drop-indicator";
    this.view.dom.appendChild(indicator);
    this.drag = { block, indicator, dropPos: null };
    this.handles.forEach((h) => h.style.display = "none");
    this.addSourceHighlight(block);
  }
  // ──────────── ブロック検出 ────────────
  detectBlock(pos) {
    switch (this.settings.moveUnit) {
      case "line":
        return getLineBlock(this.view, pos);
      case "indent":
        return getIndentBlock(this.view, pos);
      case "heading":
        return getHeadingBlock(this.view, pos);
      default:
        return getLineBlock(this.view, pos);
    }
  }
  // ──────────── ガイドライン更新 ────────────
  updateIndicator(pos) {
    if (!this.drag)
      return;
    const line = this.view.state.doc.lineAt(pos);
    const coords = this.view.coordsAtPos(line.from);
    if (!coords)
      return;
    const editorRect = this.view.dom.getBoundingClientRect();
    this.drag.indicator.style.top = `${coords.top - editorRect.top}px`;
    this.drag.indicator.style.left = "0";
    this.drag.indicator.style.width = "100%";
  }
  // ──────────── テキスト移動 ────────────
  moveBlock(block, dropPos) {
    const state = this.view.state;
    const doc = state.doc;
    const srcFirstLine = doc.lineAt(block.from);
    const srcLastLine = doc.lineAt(block.to);
    const sourceFrom = srcFirstLine.from;
    const sourceTo = srcLastLine.to < doc.length ? srcLastLine.to + 1 : srcLastLine.to;
    const blockText = state.sliceDoc(sourceFrom, sourceTo);
    const dropLine = doc.lineAt(dropPos);
    const insertPos = dropLine.from;
    if (insertPos >= sourceFrom && insertPos <= sourceTo)
      return;
    const insertText = blockText.endsWith("\n") ? blockText : blockText + "\n";
    if (sourceFrom < insertPos) {
      this.view.dispatch({
        changes: [
          { from: sourceFrom, to: sourceTo, insert: "" },
          { from: insertPos, to: insertPos, insert: insertText }
        ],
        userEvent: "move"
      });
    } else {
      this.view.dispatch({
        changes: [
          { from: insertPos, to: insertPos, insert: insertText },
          { from: sourceFrom, to: sourceTo, insert: "" }
        ],
        userEvent: "move"
      });
    }
  }
  // ──────────── ハイライト付与 / 除去 ────────────
  addSourceHighlight(block) {
    const doc = this.view.state.doc;
    const fromLine = doc.lineAt(block.from).number;
    const toLine = doc.lineAt(block.to).number;
    for (let i = fromLine; i <= toLine; i++) {
      const line = doc.line(i);
      const domAtPos = this.view.domAtPos(line.from);
      const lineEl = domAtPos.node.parentElement;
      if (lineEl && lineEl instanceof HTMLElement) {
        lineEl.classList.add("touch-reorder-drag-source");
        this.sourceLines.push(lineEl);
      }
    }
  }
  removeSourceHighlight() {
    for (const el of this.sourceLines) {
      el.classList.remove("touch-reorder-drag-source");
    }
    this.sourceLines = [];
  }
  // ──────────── 自動スクロール ────────────
  /**
   * タッチ位置からドロップ先を更新する（touchmove と autoScroll の両方から呼ばれる）
   */
  updateDropFromTouch(clientX, clientY) {
    const dropPos = this.view.posAtCoords({ x: clientX, y: clientY });
    if (dropPos == null || !this.drag)
      return;
    this.drag.dropPos = dropPos;
    this.updateIndicator(dropPos);
  }
  /**
   * 自動スクロールの rAF ループを開始する。
   * タッチ位置が画面端に近い間、繰り返しスクロールし続ける。
   */
  startAutoScroll() {
    if (this.autoScrollRAF != null)
      return;
    const loop = () => {
      if (!this.drag) {
        this.stopAutoScroll();
        return;
      }
      const scrollEl = this.view.scrollDOM;
      const rect = scrollEl.getBoundingClientRect();
      const touchY = this.lastTouchY;
      const edge = _TouchReorderPlugin.SCROLL_EDGE;
      const maxSpeed = _TouchReorderPlugin.SCROLL_MAX_SPEED;
      let speed = 0;
      if (touchY < rect.top + edge) {
        const ratio = 1 - Math.max(0, touchY - rect.top) / edge;
        speed = -maxSpeed * ratio;
      } else if (touchY > rect.bottom - edge) {
        const ratio = 1 - Math.max(0, rect.bottom - touchY) / edge;
        speed = maxSpeed * ratio;
      }
      if (speed !== 0) {
        scrollEl.scrollTop += speed;
        this.updateDropFromTouch(this.startX, this.lastTouchY);
      }
      this.autoScrollRAF = requestAnimationFrame(loop);
    };
    this.autoScrollRAF = requestAnimationFrame(loop);
  }
  stopAutoScroll() {
    if (this.autoScrollRAF != null) {
      cancelAnimationFrame(this.autoScrollRAF);
      this.autoScrollRAF = null;
    }
  }
  // ──────────── クリーンアップ ────────────
  clearTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
  cleanupDrag() {
    this.stopAutoScroll();
    if (this.drag) {
      this.drag.indicator.remove();
      this.drag = null;
    }
    this.removeSourceHighlight();
    this.view.dom.style.userSelect = "";
    this.view.dom.style.webkitUserSelect = "";
    this.updateHandlePosition();
  }
  cancelDrag() {
    this.clearTimer();
    this.cleanupDrag();
  }
};
/** 画面端からこのピクセル以内でスクロール開始 */
_TouchReorderPlugin.SCROLL_EDGE = 60;
/** 最大スクロール速度（px/frame） */
_TouchReorderPlugin.SCROLL_MAX_SPEED = 12;
var TouchReorderPlugin = _TouchReorderPlugin;
function createTouchExtension(getSettings) {
  return import_view.ViewPlugin.define(
    (view) => new TouchReorderPlugin(view, getSettings)
  );
}

// src/settings.ts
var import_obsidian = require("obsidian");
var TouchReorderSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Touch Reorder \u8A2D\u5B9A" });
    new import_obsidian.Setting(containerEl).setName("\u79FB\u52D5\u5358\u4F4D").setDesc("\u30C9\u30E9\u30C3\u30B0\u6642\u306B\u9078\u629E\u3055\u308C\u308B\u30D6\u30ED\u30C3\u30AF\u306E\u5358\u4F4D\u3092\u9078\u3073\u307E\u3059\u3002").addDropdown(
      (dropdown) => dropdown.addOption("line", "\u884C").addOption("indent", "\u30A4\u30F3\u30C7\u30F3\u30C8\uFF08\u89AA+\u5B50\u8981\u7D20\uFF09").addOption("heading", "\u30D6\u30ED\u30C3\u30AF\uFF08\u898B\u51FA\u3057\u914D\u4E0B\uFF09").setValue(this.plugin.settings.moveUnit).onChange(async (value) => {
        this.plugin.settings.moveUnit = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u9577\u62BC\u3057\u6642\u9593 (ms)").setDesc("\u30C9\u30E9\u30C3\u30B0\u3092\u958B\u59CB\u3059\u308B\u307E\u3067\u306E\u9577\u62BC\u3057\u6642\u9593\uFF0850\u301C800ms\uFF09").addSlider(
      (slider) => slider.setLimits(50, 800, 50).setValue(this.plugin.settings.longPressMs).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.longPressMs = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u63B4\u307F\u30AD\u30E3\u30F3\u30BB\u30EB\u8DDD\u96E2 (px)").setDesc("\u9577\u62BC\u3057\u4E2D\u306B\u6307\u304C\u3053\u306E\u30D4\u30AF\u30BB\u30EB\u6570\u4EE5\u4E0A\u52D5\u3044\u305F\u3089\u63B4\u307F\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\u3057\u307E\u3059\uFF085\u301C50px\uFF09").addSlider(
      (slider) => slider.setLimits(5, 50, 5).setValue(this.plugin.settings.moveCancelPx).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.moveCancelPx = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u30D0\u30A4\u30D6\u30EC\u30FC\u30B7\u30E7\u30F3").setDesc("\u30C9\u30E9\u30C3\u30B0\u958B\u59CB\u6642\u306B\u7AEF\u672B\u3092\u632F\u52D5\u3055\u305B\u307E\u3059\uFF08\u5BFE\u5FDC\u7AEF\u672B\u306E\u307F\uFF09\u3002").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.vibration).onChange(async (value) => {
        this.plugin.settings.vibration = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u30AC\u30A4\u30C9\u30E9\u30A4\u30F3\u30AB\u30E9\u30FC").setDesc("\u30C9\u30ED\u30C3\u30D7\u5148\u306E\u30AC\u30A4\u30C9\u30E9\u30A4\u30F3\u8272\uFF08\u7A7A\u6B04\u3067\u30A2\u30AF\u30BB\u30F3\u30C8\u30AB\u30E9\u30FC\u3092\u4F7F\u7528\uFF09").addText(
      (text) => text.setPlaceholder("\u4F8B: #ff6600").setValue(this.plugin.settings.guidelineColor).onChange(async (value) => {
        this.plugin.settings.guidelineColor = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  moveUnit: "line",
  longPressMs: 300,
  moveCancelPx: 20,
  vibration: true,
  guidelineColor: ""
};

// src/main.ts
var TouchReorderPlugin2 = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TouchReorderSettingTab(this.app, this));
    if (import_obsidian2.Platform.isMobile) {
      this.registerEditorExtension(
        createTouchExtension(() => this.settings)
      );
    }
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};

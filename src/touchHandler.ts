import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { getLineBlock, getIndentBlock, getHeadingBlock } from './blockDetector';
import type { TextBlock, MoveUnit, TouchReorderSettings } from './types';

// ──────────────────────────────────────────
// ドラッグ状態
// ──────────────────────────────────────────

interface DragState {
  /** ドラッグ対象のブロック（元の位置情報） */
  block: TextBlock;
  /** ドロップ先ガイドライン（2px 線） */
  indicator: HTMLElement;
  /** ドロップ先ハイライトゾーン（行全体の背景） */
  indicatorZone: HTMLElement;
  /** 現在のドロップ先ドキュメント位置 */
  dropPos: number | null;
}

// ──────────────────────────────────────────
// TouchReorderPlugin — ViewPlugin クラス
// ──────────────────────────────────────────

class TouchReorderPlugin {
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: DragState | null = null;
  private settings: TouchReorderSettings;
  private getSettings: () => TouchReorderSettings;

  /** touchstart の座標（移動量チェック用） */
  private startX = 0;
  private startY = 0;

  /** 自動スクロール用 */
  private autoScrollRAF: number | null = null;
  private lastTouchY = 0;
  /** 画面端からこのピクセル以内でスクロール開始 */
  private static readonly SCROLL_EDGE = 60;
  /** 最大スクロール速度（px/frame） */
  private static readonly SCROLL_MAX_SPEED = 12;

  // ドラッグソースを示す CSS class の付与先
  private sourceLines: HTMLElement[] = [];

  /** ドラッグハンドル要素（左・右） */
  private handles: HTMLElement[] = [];

  private touchStartedOnHandle = false;
  /** ハンドル表示中のドキュメント位置（null = 非表示） */
  private activePos: number | null = null;

  constructor(private view: EditorView, getSettings: () => TouchReorderSettings) {
    this.getSettings = getSettings;
    this.settings = getSettings();

    // touchstart も passive: false にして、ドラッグ開始時にテキスト選択を抑止する
    this.view.dom.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.view.dom.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.view.dom.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.view.dom.addEventListener('touchcancel', this.onTouchCancel, { passive: true });
    this.view.dom.addEventListener('focusin', this.onFocusIn);
    this.view.dom.addEventListener('focusout', this.onFocusOut);
    this.createHandle();
    requestAnimationFrame(() => this.syncHandleToSelection());
  }

  update(update: ViewUpdate) {
    this.settings = this.getSettings();
    if (update.selectionSet || update.geometryChanged || update.docChanged) {
      this.syncHandleToSelection();
    }
  }

  destroy() {
    this.cancelDrag();
    this.handles.forEach(h => h.remove());
    this.handles = [];
    this.view.dom.removeEventListener('touchstart', this.onTouchStart);
    this.view.dom.removeEventListener('touchmove', this.onTouchMove);
    this.view.dom.removeEventListener('touchend', this.onTouchEnd);
    this.view.dom.removeEventListener('touchcancel', this.onTouchCancel);
    this.view.dom.removeEventListener('focusin', this.onFocusIn);
    this.view.dom.removeEventListener('focusout', this.onFocusOut);
  }

  // ──────────── ドラッグハンドル ────────────

  private createHandle() {
    const makeHandle = (side: 'left' | 'right') => {
      const handle = document.createElement('div');
      handle.className = `touch-reorder-handle touch-reorder-handle--${side}`;
      handle.setAttribute('aria-label', '行を移動');
      handle.textContent = '⠿';
      this.view.dom.appendChild(handle);
      return handle;
    };
    this.handles = [makeHandle('left'), makeHandle('right')];
  }

  private updateHandlePosition() {
    if (!this.handles.length || this.drag || this.activePos === null) return;

    const lineBlock = this.view.lineBlockAt(this.activePos);
    const coords = this.view.coordsAtPos(lineBlock.from);
    if (!coords) return;

    const editorRect = this.view.dom.getBoundingClientRect();
    this.handles.forEach(h => {
      h.style.top = `${coords.top - editorRect.top}px`;
      h.style.height = `${lineBlock.height}px`;
      h.style.opacity = '0.6';
      h.style.pointerEvents = 'auto';
    });
  }

  private syncHandleToSelection(retry = true) {
    if (this.drag) return;
    if (!this.view.hasFocus) {
      this.hideHandles();
      return;
    }

    this.activePos = this.view.state.selection.main.head;
    this.updateHandlePosition();

    if (retry && this.activePos !== null) {
      requestAnimationFrame(() => this.syncHandleToSelection(false));
    }
  }

  private hideHandles() {
    this.activePos = null;
    this.handles.forEach(h => {
      h.style.opacity = '0';
      h.style.pointerEvents = 'none';
    });
  }

  private onFocusIn = () => {
    requestAnimationFrame(() => this.syncHandleToSelection());
  };

  private onFocusOut = () => {
    this.hideHandles();
  };

  // ──────────── touchstart ────────────

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    const target = e.target as HTMLElement;
    const touch = e.touches[0];

    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.touchStartedOnHandle =
      this.handles.length > 0 && this.handles.some(h => target === h || h.contains(target));

    // ── ハンドルへのタッチ: 長押しでドラッグ開始 ──
    if (this.touchStartedOnHandle) {
      e.preventDefault();
      const pos = this.activePos ?? this.view.state.selection.main.head;
      this.longPressTimer = setTimeout(() => {
        this.startDrag(pos);
      }, this.settings.longPressMs);
    }
  };

  // ──────────── touchmove ────────────

  private onTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];

    // 長押し判定中にある程度動いた → キャンセル（通常のスクロール）
    if (this.longPressTimer && !this.drag) {
      const dx = touch.clientX - this.startX;
      const dy = touch.clientY - this.startY;
      if (Math.sqrt(dx * dx + dy * dy) > this.settings.moveCancelPx) {
        this.clearTimer();
      }
      return;
    }

    if (!this.drag) return;

    // ドラッグ中はデフォルト動作（スクロール・テキスト選択）を抑止
    e.preventDefault();

    this.lastTouchY = touch.clientY;

    // ドロップ位置とガイドラインを更新
    this.updateDropFromTouch(touch.clientX, touch.clientY);

    // 自動スクロールループを開始（まだ動いていなければ）
    this.startAutoScroll();
  };

  // ──────────── touchend ────────────

  private onTouchEnd = (_e: TouchEvent) => {
    const startedOnHandle = this.touchStartedOnHandle;

    this.touchStartedOnHandle = false;
    this.clearTimer();

    if (this.drag) {
      const { block, dropPos } = this.drag;
      this.cleanupDrag();

      if (dropPos == null) return;
      // 自分自身の範囲内にドロップ → 何もしない
      if (dropPos >= block.from && dropPos <= block.to) return;

      this.moveBlock(block, dropPos);
      return;
    }

    if (startedOnHandle) return;

    requestAnimationFrame(() => this.syncHandleToSelection());
  };

  // ──────────── touchcancel ────────────

  private onTouchCancel = () => {
    this.cancelDrag();
  };

  // ──────────── ドラッグ開始 ────────────

  private startDrag(pos: number) {
    this.clearTimer();

    const block = this.detectBlock(pos);
    if (!block) return;

    // ★ テキスト選択をクリア & 抑止
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    this.view.dom.style.userSelect = 'none';
    this.view.dom.style.webkitUserSelect = 'none';

    // バイブレーション
    if (this.settings.vibration && navigator.vibrate) {
      navigator.vibrate(50);
    }

    // ドロップインジケーター生成
    const indicatorZone = document.createElement('div');
    indicatorZone.className = 'touch-reorder-drop-zone';
    this.view.dom.appendChild(indicatorZone);

    const indicator = document.createElement('div');
    indicator.className = 'touch-reorder-drop-indicator';
    this.view.dom.appendChild(indicator);

    this.drag = { block, indicator, indicatorZone, dropPos: null };

    // ドラッグ中はハンドルを非表示
    this.handles.forEach(h => {
      h.style.opacity = '0';
      h.style.pointerEvents = 'none';
    });

    // ソースブロックに半透明クラスを付与
    this.addSourceHighlight(block);
  }

  // ──────────── ブロック検出 ────────────

  private detectBlock(pos: number): TextBlock | null {
    switch (this.settings.moveUnit) {
      case 'line':
        return getLineBlock(this.view, pos);
      case 'indent':
        return getIndentBlock(this.view, pos);
      case 'heading':
        return getHeadingBlock(this.view, pos);
      default:
        return getLineBlock(this.view, pos);
    }
  }

  // ──────────── ガイドライン更新 ────────────

  private updateIndicator(pos: number) {
    if (!this.drag) return;

    const line = this.view.state.doc.lineAt(pos);
    const coords = this.view.coordsAtPos(line.from);
    if (!coords) return;

    const editorRect = this.view.dom.getBoundingClientRect();
    const top = coords.top - editorRect.top;
    const height = coords.bottom - coords.top;

    // 2px ライン
    this.drag.indicator.style.top = `${top}px`;
    this.drag.indicator.style.left = '0';
    this.drag.indicator.style.width = '100%';

    // 行全体の背景ゾーン
    this.drag.indicatorZone.style.top = `${top}px`;
    this.drag.indicatorZone.style.height = `${height}px`;
    this.drag.indicatorZone.style.left = '0';
    this.drag.indicatorZone.style.width = '100%';
  }

  // ──────────── テキスト移動 ────────────

  private moveBlock(block: TextBlock, dropPos: number) {
    const state = this.view.state;
    const doc = state.doc;

    // ソース範囲を行単位に正規化（行頭〜行末+改行）
    const srcFirstLine = doc.lineAt(block.from);
    const srcLastLine = doc.lineAt(block.to);
    const sourceFrom = srcFirstLine.from;
    // 末尾に改行があれば含める（最終行でなければ）
    const sourceTo = srcLastLine.to < doc.length
      ? srcLastLine.to + 1   // 改行を含む
      : srcLastLine.to;

    const blockText = state.sliceDoc(sourceFrom, sourceTo);

    // ドロップ先の行頭
    const dropLine = doc.lineAt(dropPos);
    const insertPos = dropLine.from;

    // ソース範囲内にドロップ → 何もしない
    if (insertPos >= sourceFrom && insertPos <= sourceTo) return;

    // 挿入テキスト: 末尾に改行がなければ付与（行として挿入するため）
    const insertText = blockText.endsWith('\n') ? blockText : blockText + '\n';

    // ★ CM6 の changes は from 昇順でなければならない
    // ソースがドロップ先より前にある場合（下へ移動）
    if (sourceFrom < insertPos) {
      this.view.dispatch({
        changes: [
          { from: sourceFrom, to: sourceTo, insert: '' },
          { from: insertPos, to: insertPos, insert: insertText },
        ],
        userEvent: 'move',
      });
    }
    // ソースがドロップ先より後にある場合（上へ移動）
    else {
      this.view.dispatch({
        changes: [
          { from: insertPos, to: insertPos, insert: insertText },
          { from: sourceFrom, to: sourceTo, insert: '' },
        ],
        userEvent: 'move',
      });
    }
  }

  // ──────────── ハイライト付与 / 除去 ────────────

  private addSourceHighlight(block: TextBlock) {
    const doc = this.view.state.doc;
    const fromLine = doc.lineAt(block.from).number;
    const toLine = doc.lineAt(block.to).number;

    for (let i = fromLine; i <= toLine; i++) {
      const line = doc.line(i);
      const domAtPos = this.view.domAtPos(line.from);
      const lineEl = domAtPos.node.parentElement;
      if (lineEl && lineEl instanceof HTMLElement) {
        lineEl.classList.add('touch-reorder-drag-source');
        this.sourceLines.push(lineEl);
      }
    }
  }

  private removeSourceHighlight() {
    for (const el of this.sourceLines) {
      el.classList.remove('touch-reorder-drag-source');
    }
    this.sourceLines = [];
  }

  // ──────────── 自動スクロール ────────────

  /**
   * タッチ位置からドロップ先を更新する（touchmove と autoScroll の両方から呼ばれる）
   */
  private updateDropFromTouch(clientX: number, clientY: number) {
    const dropPos = this.view.posAtCoords({ x: clientX, y: clientY });
    if (dropPos == null || !this.drag) return;
    this.drag.dropPos = dropPos;
    this.updateIndicator(dropPos);
  }

  /**
   * 自動スクロールの rAF ループを開始する。
   * タッチ位置が画面端に近い間、繰り返しスクロールし続ける。
   */
  private startAutoScroll() {
    if (this.autoScrollRAF != null) return; // 既に動作中

    const loop = () => {
      if (!this.drag) {
        this.stopAutoScroll();
        return;
      }

      const scrollEl = this.view.scrollDOM;
      const rect = scrollEl.getBoundingClientRect();
      const touchY = this.lastTouchY;
      const edge = TouchReorderPlugin.SCROLL_EDGE;
      const maxSpeed = TouchReorderPlugin.SCROLL_MAX_SPEED;

      let speed = 0;

      if (touchY < rect.top + edge) {
        // 上端に近い → 上にスクロール
        const ratio = 1 - Math.max(0, touchY - rect.top) / edge;
        speed = -maxSpeed * ratio;
      } else if (touchY > rect.bottom - edge) {
        // 下端に近い → 下にスクロール
        const ratio = 1 - Math.max(0, rect.bottom - touchY) / edge;
        speed = maxSpeed * ratio;
      }

      if (speed !== 0) {
        scrollEl.scrollTop += speed;
        // スクロール後にドロップ位置を再計算（指の位置は変わっていないが表示が変わった）
        this.updateDropFromTouch(this.startX, this.lastTouchY);
      }

      this.autoScrollRAF = requestAnimationFrame(loop);
    };

    this.autoScrollRAF = requestAnimationFrame(loop);
  }

  private stopAutoScroll() {
    if (this.autoScrollRAF != null) {
      cancelAnimationFrame(this.autoScrollRAF);
      this.autoScrollRAF = null;
    }
  }

  // ──────────── クリーンアップ ────────────

  private clearTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private cleanupDrag() {
    this.stopAutoScroll();

    if (this.drag) {
      this.drag.indicator.remove();
      this.drag.indicatorZone.remove();
      this.drag = null;
    }
    this.removeSourceHighlight();

    // ★ テキスト選択の抑止を解除
    this.view.dom.style.userSelect = '';
    this.view.dom.style.webkitUserSelect = '';

    this.syncHandleToSelection();
  }

  private cancelDrag() {
    this.clearTimer();
    this.cleanupDrag();
  }
}

// ──────────────────────────────────────────
// Extension 生成関数
// ──────────────────────────────────────────

export function createTouchExtension(getSettings: () => TouchReorderSettings) {
  return ViewPlugin.define(
    (view) => new TouchReorderPlugin(view, getSettings),
  );
}

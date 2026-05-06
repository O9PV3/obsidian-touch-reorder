# DESIGN.md — Obsidian Touch Reorder Plugin

## 1. Platform.isMobile の使い方

Obsidian は `Platform` オブジェクトを提供しており、モバイル判定に利用できる。

```typescript
import { Platform } from 'obsidian';

if (Platform.isMobile) {
  // モバイル向け処理（タッチハンドラー登録）
}
if (Platform.isIosApp) { /* iOS固有処理 */ }
if (Platform.isAndroidApp) { /* Android固有処理 */ }
```

プラグインのロード時にこれをチェックし、モバイルの場合のみ `touchHandler` を初期化する。

---

## 2. CodeMirror 6 でタッチイベントを登録する方法

CM6 では `EditorView.domEventHandlers` facet を使い、DOM イベントをインターセプトする。

```typescript
import { EditorView } from '@codemirror/view';

const touchExtension = EditorView.domEventHandlers({
  touchstart(event: TouchEvent, view: EditorView) {
    // 長押しタイマーを開始
    return false; // false を返すとデフォルト動作を許可
  },
  touchmove(event: TouchEvent, view: EditorView) {
    // ドラッグモード中のみ preventDefault() で
    // スクロールを止め、ガイドラインを更新
    return false;
  },
  touchend(event: TouchEvent, view: EditorView) {
    // ドラッグモード中であれば dispatch でテキスト移動
    return false;
  },
});
```

### passive: false の登録

`domEventHandlers` ではイベントリスナーのオプションを直接指定できないため、
ドラッグモード判定後に `e.preventDefault()` を呼ぶ場合は、
`ViewPlugin` の `create` 内で直接 DOM に登録する。

```typescript
import { ViewPlugin, EditorView } from '@codemirror/view';

const touchPlugin = ViewPlugin.fromClass(class {
  private onTouchMove: (e: TouchEvent) => void;

  constructor(private view: EditorView) {
    this.onTouchMove = (e: TouchEvent) => {
      if (isDragging) {
        e.preventDefault(); // スクロール抑止
        // ガイドライン更新
      }
    };
    // passive: false が必須
    this.view.dom.addEventListener('touchmove', this.onTouchMove, { passive: false });
  }

  destroy() {
    this.view.dom.removeEventListener('touchmove', this.onTouchMove);
  }
});
```

---

## 3. view.posAtCoords() でタッチ座標からカーソル位置を取得

```typescript
function getDropPosition(view: EditorView, touch: Touch): number | null {
  return view.posAtCoords({ x: touch.clientX, y: touch.clientY });
}
```

- 戻り値は `number | null`（座標がエディタ外の場合 `null`）。
- `null` の場合はドロップをキャンセルする。

---

## 4. SyntaxTree から段落・見出しブロックの範囲を取得

Lezer の SyntaxTree にアクセスし、ノードタイプ名でブロック境界を判定する。

```typescript
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

function getHeadingBlock(state: EditorState, pos: number): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  let headingNode: { from: number; to: number; level: number } | null = null;

  // pos を含む見出しノードを探す
  tree.iterate({
    enter(node) {
      const match = node.type.name.match(/^ATXHeading(\d)$/);
      if (match) {
        const level = parseInt(match[1], 10);
        if (node.from <= pos && pos <= node.to) {
          headingNode = { from: node.from, to: node.to, level };
        }
      }
    },
  });

  if (!headingNode) return null;

  // 同レベル以上の次の見出し or ドキュメント末尾まで拡張
  const doc = state.doc;
  let blockEnd = doc.length;

  tree.iterate({
    from: headingNode.to,
    enter(node) {
      const match = node.type.name.match(/^ATXHeading(\d)$/);
      if (match) {
        const nextLevel = parseInt(match[1], 10);
        if (nextLevel <= headingNode!.level) {
          blockEnd = Math.min(blockEnd, node.from);
          return false; // 走査終了
        }
      }
    },
  });

  return { from: headingNode.from, to: blockEnd };
}
```

### 段落ブロック（空行区切り）

```typescript
function getParagraphBlock(state: EditorState, pos: number): { from: number; to: number } {
  const doc = state.doc;
  const line = doc.lineAt(pos);

  // 上方向に空行を探す
  let from = line.from;
  for (let i = line.number - 1; i >= 1; i--) {
    const prev = doc.line(i);
    if (prev.text.trim() === '') break;
    from = prev.from;
  }

  // 下方向に空行を探す
  let to = line.to;
  for (let i = line.number + 1; i <= doc.lines; i++) {
    const next = doc.line(i);
    if (next.text.trim() === '') break;
    to = next.to;
  }

  return { from, to };
}
```

---

## 5. view.dispatch() でテキストを移動する際の changes の組み立て方

テキスト移動は「ソースの削除」と「ターゲットへの挿入」を **1回の dispatch** で行う。
位置のずれを考慮して changes を組み立てる必要がある。

```typescript
function moveBlock(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
  dropPos: number
) {
  const text = view.state.sliceDoc(sourceFrom, sourceTo);

  // ソースがドロップ先より前にある場合
  // 先に削除するとドロップ位置がずれるため、逆順で changes を組む
  if (sourceFrom < dropPos) {
    const adjustedDrop = dropPos - (sourceTo - sourceFrom);
    view.dispatch({
      changes: [
        { from: sourceFrom, to: sourceTo, insert: '' },  // 削除
        { from: adjustedDrop, to: adjustedDrop, insert: text }, // 挿入
      ],
      // Undo で1操作としてまとめる
      userEvent: 'move',
    });
  } else {
    view.dispatch({
      changes: [
        { from: dropPos, to: dropPos, insert: text }, // 挿入
        { from: sourceFrom, to: sourceTo, insert: '' },  // 削除
      ],
      userEvent: 'move',
    });
  }
}
```

> **重要:** CM6 の `dispatch` は `changes` 配列内の各変更を **元のドキュメント位置** で解釈する。
> つまり、同時に渡す複数の changes は互いに影響しない（先に適用されたものがズレを起こさない）。
> そのため、上記のような位置調整は実は不要で、直接 from/to をそのまま渡せる。

```typescript
// 簡易版（CM6 が自動的に位置調整を行う）
function moveBlockSimple(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
  dropPos: number
) {
  const text = view.state.sliceDoc(sourceFrom, sourceTo);
  view.dispatch({
    changes: [
      { from: sourceFrom, to: sourceTo, insert: '' },
      { from: dropPos, to: dropPos, insert: text },
    ],
    userEvent: 'move',
  });
}
```

---

## アーキテクチャ概要

```
main.ts
  ├─ onload(): Platform.isMobile チェック → registerEditorExtension()
  │     └─ ViewPlugin (touchPlugin)
  │           ├─ touchstart → 長押しタイマー開始
  │           ├─ touchmove  → passive:false, ガイドライン描画
  │           └─ touchend   → dispatch() で移動実行
  │
  ├─ blockDetector.ts … getLineBlock / getParagraphBlock / getHeadingBlock
  └─ settings.ts … 設定UI（移動単位、長押し時間等）
```

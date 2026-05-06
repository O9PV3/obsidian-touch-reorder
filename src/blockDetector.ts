import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { TextBlock } from './types';

// ──────────────────────────────────────────
// 行単位
// ──────────────────────────────────────────

/**
 * カーソル位置を含む1行のみを返す。
 */
export function getLineBlock(view: EditorView, pos: number): TextBlock {
  const line = view.state.doc.lineAt(pos);
  return {
    from: line.from,
    to: line.to,
    text: line.text,
  };
}

// ──────────────────────────────────────────
// インデント単位（対象行 + 子要素）
// ──────────────────────────────────────────

/**
 * 行のインデントレベル（先頭のスペース/タブ数）を返す。
 * タブは4スペースとしてカウント。
 */
function getIndentLevel(lineText: string): number {
  let level = 0;
  for (const ch of lineText) {
    if (ch === ' ') level += 1;
    else if (ch === '\t') level += 4;
    else break;
  }
  return level;
}

/**
 * 見出し行かどうかを判定し、見出しレベルを返す。
 * 見出しでない場合は 0 を返す。
 */
function getHeadingLevel(lineText: string): number {
  const match = lineText.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

/**
 * カーソル位置の行と、その子要素をまとめて返す。
 *
 * ■ 見出し行（# で始まる行）を掴んだ場合:
 *   次の同レベル以上の見出しが来るまでの全行を含める（インデント不問）。
 *
 *   例:
 *     ## 見出しA      ← 長押し
 *     本文テキスト    ← 含まれる（インデント無しでもOK）
 *     ### 子見出し    ← 含まれる（レベルが深い）
 *     ## 見出しB      ← 含まれない（同レベル）
 *
 * ■ 通常の行を掴んだ場合:
 *   インデントが深い直下の行（子要素）のみを含める。
 *   空行が来たら打ち切り。
 */
export function getIndentBlock(view: EditorView, pos: number): TextBlock {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const headingLv = getHeadingLevel(line.text);

  let toLine = line.number;

  if (headingLv > 0) {
    // ── 見出し行: 次の同レベル以上の見出しまで ──
    for (let i = line.number + 1; i <= doc.lines; i++) {
      const next = doc.line(i);
      const nextHeadingLv = getHeadingLevel(next.text);
      // 同レベル以上の見出しが来たら打ち切り
      if (nextHeadingLv > 0 && nextHeadingLv <= headingLv) break;
      toLine = i;
    }
  } else {
    // ── 通常行: インデントベース ──
    const baseIndent = getIndentLevel(line.text);
    for (let i = line.number + 1; i <= doc.lines; i++) {
      const next = doc.line(i);
      if (next.text.trim() === '') break;
      if (getIndentLevel(next.text) <= baseIndent) break;
      toLine = i;
    }
  }

  const from = line.from;
  const to = doc.line(toLine).to;

  return {
    from,
    to,
    text: doc.sliceString(from, to),
  };
}

// ──────────────────────────────────────────
// ブロック単位（見出し＋配下）
// ──────────────────────────────────────────

/**
 * カーソル位置を含む見出しブロック（見出し行 + 次の同レベル以上の見出しの直前まで）を返す。
 * 見出し行上にカーソルがない場合は、直近の親見出しを基準にする。
 * 見出しが全く見つからない場合は `null` を返す。
 */
export function getHeadingBlock(view: EditorView, pos: number): TextBlock | null {
  const state = view.state;
  const tree = syntaxTree(state);
  const doc = state.doc;

  // pos 以前で最も近い見出しを探す
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
    },
  });

  if (headingFrom < 0) return null;

  // 次の同レベル以上の見出し or 文末までを走査
  let blockEnd = doc.length;
  let found = false;

  tree.iterate({
    from: headingFrom + 1,
    enter(node) {
      if (found) return false;
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
    },
  });

  return {
    from: headingFrom,
    to: blockEnd,
    text: doc.sliceString(headingFrom, blockEnd),
  };
}

// Canvas描画エンジン
// PDF上に透明なCanvasレイヤーで描画を管理

import { smoothStroke, distance } from './utils.js';

/**
 * 描画ツールの種類
 */
export const DrawingTool = {
  PEN: 'pen',
  HIGHLIGHTER: 'highlighter',
  ERASER: 'eraser',
};

/**
 * 描画エンジンクラス
 * Canvas上でのフリーハンド描画・消しゴム・Undo/Redoを管理
 */
export class DrawingEngine {
  /**
   * @param {HTMLCanvasElement} canvas - 描画用Canvasエレメント
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // 描画設定
    this.tool = DrawingTool.PEN;
    this.color = '#1a1a2e';
    this.lineWidth = 2;
    this.highlighterOpacity = 0.3;

    // 描画状態
    this.isDrawing = false;
    this.currentStroke = null;

    // ストローク管理
    this.strokes = [];
    this.undoStack = []; // 操作履歴（Undo用）
    this.redoStack = []; // Redo用スタック

    // スケール（ズーム対応）
    this.scale = 1.0;

    // コールバック
    this.onStrokeEnd = null; // ストローク完了時のコールバック

    // イベントバインド
    this._bindEvents();
  }

  /**
   * イベントリスナーをバインド
   */
  _bindEvents() {
    // removeEventListenerで確実に解除できるよう、バインド済み参照を保持
    this._boundPointerDown = (e) => this._onPointerDown(e);
    this._boundPointerMove = (e) => this._onPointerMove(e);
    this._boundPointerUp = (e) => this._onPointerUp(e);
    this._boundTouchStart = (e) => {
      if (this.tool !== null) e.preventDefault();
    };

    this.canvas.addEventListener('pointerdown', this._boundPointerDown);
    this.canvas.addEventListener('pointermove', this._boundPointerMove);
    this.canvas.addEventListener('pointerup', this._boundPointerUp);
    this.canvas.addEventListener('pointerleave', this._boundPointerUp);

    // タッチスクロール防止
    this.canvas.addEventListener('touchstart', this._boundTouchStart, { passive: false });
  }

  /**
   * Canvas座標に変換（スケール・オフセット考慮）
   */
  _getCanvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
      pressure: e.pressure || 0.5,
    };
  }

  /**
   * ポインターダウン処理
   */
  _onPointerDown(e) {
    if (e.button !== 0) return; // 左クリックのみ

    this.isDrawing = true;
    const point = this._getCanvasPoint(e);

    if (this.tool === DrawingTool.ERASER) {
      this._erase(point);
      return;
    }

    this.currentStroke = {
      tool: this.tool,
      color: this.color,
      lineWidth: this.tool === DrawingTool.HIGHLIGHTER ? this.lineWidth * 4 : this.lineWidth,
      opacity: this.tool === DrawingTool.HIGHLIGHTER ? this.highlighterOpacity : 1.0,
      points: [point],
    };

    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);
  }

  /**
   * ポインタームーブ処理
   */
  _onPointerMove(e) {
    if (!this.isDrawing) return;

    const point = this._getCanvasPoint(e);

    if (this.tool === DrawingTool.ERASER) {
      this._erase(point);
      return;
    }

    if (!this.currentStroke) return;

    this.currentStroke.points.push(point);

    // リアルタイム描画
    const prevPoint = this.currentStroke.points[this.currentStroke.points.length - 2];
    this._drawSegment(prevPoint, point, this.currentStroke);
  }

  /**
   * ポインターアップ処理
   */
  _onPointerUp(_e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.tool === DrawingTool.ERASER) return;

    if (this.currentStroke && this.currentStroke.points.length > 0) {
      // ストロークを平滑化して保存
      this.currentStroke.points = smoothStroke(this.currentStroke.points);
      this.strokes.push(this.currentStroke);
      this.undoStack.push({ type: 'draw', stroke: this.currentStroke });
      this.redoStack = []; // 新しい操作でRedoスタックをクリア

      // 全体を再描画（平滑化反映）
      this.redraw();

      // コールバック呼び出し
      if (this.onStrokeEnd) {
        this.onStrokeEnd(this.strokes);
      }
    }

    this.currentStroke = null;
  }

  /**
   * 線分を描画
   */
  _drawSegment(from, to, stroke) {
    this.ctx.save();
    this.ctx.globalAlpha = stroke.opacity;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (stroke.tool === DrawingTool.HIGHLIGHTER) {
      this.ctx.globalCompositeOperation = 'multiply';
    }

    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * ストローク全体を描画
   */
  _drawStroke(stroke) {
    if (stroke.points.length === 0) return;

    this.ctx.save();
    this.ctx.globalAlpha = stroke.opacity;
    this.ctx.strokeStyle = stroke.color;
    this.ctx.lineWidth = stroke.lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (stroke.tool === DrawingTool.HIGHLIGHTER) {
      this.ctx.globalCompositeOperation = 'multiply';
    }

    this.ctx.beginPath();
    this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

    if (stroke.points.length === 1) {
      // 点の場合
      this.ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.lineWidth / 2, 0, Math.PI * 2);
      this.ctx.fillStyle = stroke.color;
      this.ctx.fill();
    } else if (stroke.points.length === 2) {
      this.ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
    } else {
      // ベジェ曲線で滑らかに描画
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const cp = stroke.points[i];
        const next = stroke.points[i + 1];
        const mx = (cp.x + next.x) / 2;
        const my = (cp.y + next.y) / 2;
        this.ctx.quadraticCurveTo(cp.x, cp.y, mx, my);
      }
      // 最後の点まで描画
      const last = stroke.points[stroke.points.length - 1];
      this.ctx.lineTo(last.x, last.y);
    }

    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * 消しゴム処理（ストローク単位で消去）
   */
  _erase(point) {
    const eraserRadius = this.lineWidth * 3;
    let erased = false;

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      for (const p of stroke.points) {
        if (distance(point, p) < eraserRadius) {
          // ストロークを削除してUndoスタックに保存
          this.undoStack.push({
            type: 'erase',
            stroke: this.strokes.splice(i, 1)[0],
            index: i,
          });
          erased = true;
          break;
        }
      }
    }

    if (erased) {
      this.redoStack = []; // 新しい操作でRedoスタックをクリア
      this.redraw();
      if (this.onStrokeEnd) {
        this.onStrokeEnd(this.strokes);
      }
    }
  }

  /**
   * 全ストロークを再描画
   */
  redraw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.strokes) {
      this._drawStroke(stroke);
    }
  }

  /**
   * Undo操作
   * undoStackには操作履歴を積み、操作の逆順で処理する
   */
  undo() {
    if (this.undoStack.length === 0) return;

    const entry = this.undoStack.pop();
    if (entry.type === 'draw') {
      // 描画を取り消す → strokesから末尾を除去してredoStackへ
      this.strokes.pop();
      this.redoStack.push({ type: 'draw', stroke: entry.stroke });
    } else if (entry.type === 'erase') {
      // 消しゴムを取り消す → 元の位置にストロークを復元してredoStackへ
      this.strokes.splice(entry.index, 0, entry.stroke);
      this.redoStack.push({ type: 'erase', stroke: entry.stroke, index: entry.index });
    }

    this.redraw();
    if (this.onStrokeEnd) this.onStrokeEnd(this.strokes);
  }

  /**
   * Redo操作
   */
  redo() {
    if (this.redoStack.length === 0) return;

    const entry = this.redoStack.pop();
    if (entry.type === 'draw') {
      this.strokes.push(entry.stroke);
      this.undoStack.push({ type: 'draw', stroke: entry.stroke });
    } else if (entry.type === 'erase') {
      this.strokes.splice(entry.index, 1);
      this.undoStack.push({ type: 'erase', stroke: entry.stroke, index: entry.index });
    }

    this.redraw();
    if (this.onStrokeEnd) this.onStrokeEnd(this.strokes);
  }

  /**
   * ストロークをセット（ページ切替時の復元用）
   * @param {Array} strokes
   */
  setStrokes(strokes) {
    this.strokes = strokes ? JSON.parse(JSON.stringify(strokes)) : [];
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
  }

  /**
   * 全ストロークを取得
   * @returns {Array}
   */
  getStrokes() {
    return JSON.parse(JSON.stringify(this.strokes));
  }

  /**
   * Canvasサイズを更新
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.redraw();
  }

  /**
   * すべてクリア
   */
  clear() {
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.redraw();
  }

  /**
   * 指定のCanvasコンテキストにストローク配列を描画（エクスポート用静的メソッド）
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} strokes
   */
  static drawStrokesToContext(ctx, strokes) {
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.globalAlpha = stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.tool === DrawingTool.HIGHLIGHTER) {
        ctx.globalCompositeOperation = 'multiply';
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

      if (stroke.points.length === 1) {
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
      } else if (stroke.points.length === 2) {
        ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
      } else {
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const cp = stroke.points[i];
          const next = stroke.points[i + 1];
          const mx = (cp.x + next.x) / 2;
          const my = (cp.y + next.y) / 2;
          ctx.quadraticCurveTo(cp.x, cp.y, mx, my);
        }
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last.x, last.y);
      }

      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * リソース解放
   */
  destroy() {
    this.canvas.removeEventListener('pointerdown', this._boundPointerDown);
    this.canvas.removeEventListener('pointermove', this._boundPointerMove);
    this.canvas.removeEventListener('pointerup', this._boundPointerUp);
    this.canvas.removeEventListener('pointerleave', this._boundPointerUp);
    this.canvas.removeEventListener('touchstart', this._boundTouchStart);
    this.clear();
  }
}

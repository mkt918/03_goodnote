// ユーティリティ関数群

/**
 * UUID v4 生成
 * @returns {string} UUID
 */
export function generateId() {
  return crypto.randomUUID();
}

/**
 * 日付フォーマット
 * @param {Date|number} date - Dateオブジェクトまたはタイムスタンプ
 * @returns {string} フォーマット済み文字列
 */
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

/**
 * デバウンス関数
 * @param {Function} fn - 実行する関数
 * @param {number} delay - 遅延時間（ms）
 * @returns {Function} デバウンス済み関数
 */
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * ファイルサイズの人間可読フォーマット
 * @param {number} bytes - バイト数
 * @returns {string} フォーマット済みサイズ
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

/**
 * ベジェ曲線補間でストロークを平滑化
 * @param {Array} points - [{x, y}, ...] のポイント配列
 * @returns {Array} 平滑化されたポイント配列
 */
export function smoothStroke(points) {
  if (points.length < 3) return points;

  const smoothed = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // 移動平均で平滑化
    smoothed.push({
      x: (prev.x + curr.x * 2 + next.x) / 4,
      y: (prev.y + curr.y * 2 + next.y) / 4,
      pressure: curr.pressure || 1,
    });
  }

  smoothed.push(points[points.length - 1]);
  return smoothed;
}

/**
 * 2点間の距離を計算
 * @param {Object} p1 - {x, y}
 * @param {Object} p2 - {x, y}
 * @returns {number} 距離
 */
export function distance(p1, p2) {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

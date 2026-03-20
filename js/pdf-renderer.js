// PDF.js ラッパーモジュール
// PDF.jsを使ったPDFレンダリング管理

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs';
const PDFJS_WORKER_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs';

let pdfjsLib = null;

/**
 * PDF.jsライブラリを初期化
 */
async function initPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(PDFJS_CDN);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
  return pdfjsLib;
}

/**
 * PDFレンダラークラス
 * PDFドキュメントのロード・ページレンダリングを管理
 */
export class PdfRenderer {
  constructor() {
    this.pdfDoc = null;
    this.pageCount = 0;
    this.pageCache = new Map(); // ページキャッシュ
  }

  /**
   * PDFをArrayBufferから読み込む
   * @param {ArrayBuffer} data - PDFデータ
   */
  async loadFromData(data) {
    const lib = await initPdfJs();
    this.pdfDoc = await lib.getDocument({ data }).promise;
    this.pageCount = this.pdfDoc.numPages;
    this.pageCache.clear();
    return this.pageCount;
  }

  /**
   * PDFをURLから読み込む
   * @param {string} url - PDF URL
   */
  async loadFromUrl(url) {
    const lib = await initPdfJs();
    this.pdfDoc = await lib.getDocument(url).promise;
    this.pageCount = this.pdfDoc.numPages;
    this.pageCache.clear();
    return this.pageCount;
  }

  /**
   * 指定ページを取得（キャッシュ付き）
   * @param {number} pageNum - ページ番号（1始まり）
   * @returns {Promise<PDFPageProxy>}
   */
  async getPage(pageNum) {
    if (!this.pdfDoc) throw new Error('PDFが読み込まれていません');
    if (pageNum < 1 || pageNum > this.pageCount) {
      throw new Error(`ページ番号が範囲外です: ${pageNum}`);
    }

    if (this.pageCache.has(pageNum)) {
      return this.pageCache.get(pageNum);
    }

    const page = await this.pdfDoc.getPage(pageNum);
    this.pageCache.set(pageNum, page);
    return page;
  }

  /**
   * 指定ページをCanvasにレンダリング
   * @param {number} pageNum - ページ番号
   * @param {HTMLCanvasElement} canvas - 描画先Canvas
   * @param {number} scale - 表示スケール
   * @returns {Promise<{width: number, height: number}>} 描画サイズ
   */
  async renderPage(pageNum, canvas, scale = 1.0) {
    const page = await this.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return { width: viewport.width, height: viewport.height };
  }

  /**
   * ページのオリジナルサイズを取得
   * @param {number} pageNum
   * @returns {Promise<{width: number, height: number}>}
   */
  async getPageSize(pageNum) {
    const page = await this.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    return { width: viewport.width, height: viewport.height };
  }

  /**
   * サムネイル生成
   * @param {number} pageNum
   * @param {number} maxWidth - 最大幅
   * @returns {Promise<string>} data URL
   */
  async generateThumbnail(pageNum, maxWidth = 200) {
    const page = await this.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = maxWidth / viewport.width;
    const thumbViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = thumbViewport.width;
    canvas.height = thumbViewport.height;

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: thumbViewport,
    }).promise;

    return canvas.toDataURL('image/jpeg', 0.7);
  }

  /**
   * リソース解放
   */
  destroy() {
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
    this.pageCache.clear();
    this.pageCount = 0;
  }
}

// PDFビューアー メインロジック

import { PdfRenderer } from './pdf-renderer.js';
import { DrawingEngine, DrawingTool } from './drawing-engine.js';
import {
  initDB,
  getDocument,
  saveDocument,
  saveAnnotation,
  getAnnotation,
} from './storage.js';
import { debounce } from './utils.js';

// === 状態管理 ===
let docId = null;
let docData = null;
let pdfRenderer = null;
let currentPage = 1;
let totalPages = 1;
let scale = 1.0;
let isSpreadView = false;

// ページごとの描画エンジンマップ
let drawingEngines = new Map(); // pageNum -> DrawingEngine

// 白紙ページの追加分を管理
let extraBlankPages = 0;

// === DOM要素 ===
const docTitle = document.getElementById('doc-title');
const saveIndicator = document.getElementById('save-indicator');
const pagesContainer = document.getElementById('pages-container');
const loading = document.getElementById('loading');
const pageInput = document.getElementById('page-input');
const pageTotal = document.getElementById('page-total');
const zoomResetBtn = document.getElementById('btn-zoom-reset');
const viewerMain = document.getElementById('viewer-main');

// === 初期化 ===
async function init() {
  await initDB();

  // URLからドキュメントIDを取得
  const params = new URLSearchParams(window.location.search);
  docId = params.get('id');

  if (!docId) {
    alert('ドキュメントが指定されていません');
    window.location.href = 'index.html';
    return;
  }

  // ドキュメント読み込み
  docData = await getDocument(docId);
  if (!docData) {
    alert('ドキュメントが見つかりません');
    window.location.href = 'index.html';
    return;
  }

  docTitle.textContent = docData.name;
  document.title = `${docData.name} - GoodNote`;

  // PDF/白紙の初期化
  if (docData.type === 'pdf' && docData.pdfData) {
    pdfRenderer = new PdfRenderer();
    totalPages = await pdfRenderer.loadFromData(docData.pdfData);
  } else {
    totalPages = docData.pageCount || 1;
  }

  extraBlankPages = Math.max(0, totalPages - (pdfRenderer ? pdfRenderer.pageCount : 0));

  pageTotal.textContent = totalPages;
  pageInput.max = totalPages;

  // ページ表示
  await renderPages();
  loading.classList.add('hidden');
  pagesContainer.classList.remove('hidden');

  // イベント設定
  bindEvents();
}

// === ページ描画 ===
async function renderPages() {
  // 既存の描画エンジンのストロークを保存
  await saveAllAnnotations();

  pagesContainer.innerHTML = '';
  drawingEngines.clear();

  if (isSpreadView) {
    // 見開き表示
    pagesContainer.className = 'spread-view py-6';
    const leftPage = currentPage;
    const rightPage = currentPage + 1;
    await createPageElement(leftPage);
    if (rightPage <= totalPages) {
      await createPageElement(rightPage);
    }
  } else {
    // 単一ページ表示
    pagesContainer.className = 'flex flex-col items-center py-6';
    await createPageElement(currentPage);
  }
}

async function createPageElement(pageNum) {
  if (pageNum < 1 || pageNum > totalPages) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'page-wrapper';
  wrapper.dataset.page = pageNum;

  // PDFキャンバス
  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.className = 'pdf-canvas';

  // 描画キャンバス（PDFの上に重ねる）
  const drawCanvas = document.createElement('canvas');
  drawCanvas.className = 'drawing-canvas';

  wrapper.appendChild(pdfCanvas);
  wrapper.appendChild(drawCanvas);
  pagesContainer.appendChild(wrapper);

  // PDFまたは白紙をレンダリング
  const origPageCount = pdfRenderer ? pdfRenderer.pageCount : 0;
  const isBlankPage = pageNum > origPageCount;

  let pageWidth, pageHeight;

  if (isBlankPage) {
    // 白紙ページ（A4サイズ相当 595x842）
    pageWidth = 595 * scale;
    pageHeight = 842 * scale;
    pdfCanvas.width = pageWidth;
    pdfCanvas.height = pageHeight;
    const ctx = pdfCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    // 罫線（薄い線）
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    const lineSpacing = 28 * scale;
    for (let y = lineSpacing; y < pageHeight; y += lineSpacing) {
      ctx.beginPath();
      ctx.moveTo(20 * scale, y);
      ctx.lineTo(pageWidth - 20 * scale, y);
      ctx.stroke();
    }
  } else {
    const size = await pdfRenderer.renderPage(pageNum, pdfCanvas, scale);
    pageWidth = size.width;
    pageHeight = size.height;
  }

  // 描画キャンバスのサイズをPDFに合わせる
  drawCanvas.width = pageWidth;
  drawCanvas.height = pageHeight;
  drawCanvas.style.width = pdfCanvas.style.width || `${pageWidth}px`;
  drawCanvas.style.height = pdfCanvas.style.height || `${pageHeight}px`;

  // 描画エンジンを紐づけ
  const engine = new DrawingEngine(drawCanvas);
  applyCurrentToolSettings(engine);

  // 保存済みアノテーションを復元
  const annotation = await getAnnotation(docId, pageNum);
  if (annotation && annotation.strokes) {
    engine.setStrokes(annotation.strokes);
  }

  // ストローク完了時に自動保存
  engine.onStrokeEnd = debounce(async (strokes) => {
    showSaving();
    await saveAnnotation(docId, pageNum, strokes);
    showSaved();
  }, 1500);

  // 消しゴムモード時はカーソル変更
  updateDrawingCanvasCursor(drawCanvas);

  drawingEngines.set(pageNum, engine);
}

// === ツール設定の適用 ===
function applyCurrentToolSettings(engine) {
  const activeTool = document.querySelector('.tool-btn.active[id^="tool-"]');
  if (activeTool) {
    switch (activeTool.id) {
      case 'tool-pen': engine.tool = DrawingTool.PEN; break;
      case 'tool-highlighter': engine.tool = DrawingTool.HIGHLIGHTER; break;
      case 'tool-eraser': engine.tool = DrawingTool.ERASER; break;
    }
  }

  const activeColor = document.querySelector('.color-dot.active');
  if (activeColor) {
    engine.color = activeColor.dataset.color;
  }

  engine.lineWidth = parseInt(document.getElementById('line-width').value);
}

function updateDrawingCanvasCursor(canvas) {
  const activeTool = document.querySelector('.tool-btn.active[id^="tool-"]');
  if (activeTool && activeTool.id === 'tool-eraser') {
    canvas.classList.add('eraser-mode');
  } else {
    canvas.classList.remove('eraser-mode');
  }
}

// === イベントバインド ===
function bindEvents() {
  // 戻るボタン
  document.getElementById('btn-back').addEventListener('click', () => {
    saveAllAnnotations().then(() => {
      window.location.href = 'index.html';
    });
  });

  // ツール切替
  const toolBtns = ['tool-pen', 'tool-highlighter', 'tool-eraser'];
  toolBtns.forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
      toolBtns.forEach((bid) => {
        document.getElementById(bid).classList.remove('active');
        document.getElementById(bid).classList.add('text-gray-500');
      });
      document.getElementById(id).classList.add('active');
      document.getElementById(id).classList.remove('text-gray-500');

      let tool;
      switch (id) {
        case 'tool-pen': tool = DrawingTool.PEN; break;
        case 'tool-highlighter': tool = DrawingTool.HIGHLIGHTER; break;
        case 'tool-eraser': tool = DrawingTool.ERASER; break;
      }

      drawingEngines.forEach((engine) => {
        engine.tool = tool;
      });

      // カーソル更新
      document.querySelectorAll('.drawing-canvas').forEach((c) => {
        updateDrawingCanvasCursor(c);
      });
    });
  });

  // カラー選択
  document.querySelectorAll('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
      const color = dot.dataset.color;
      drawingEngines.forEach((engine) => {
        engine.color = color;
      });
    });
  });

  // カスタムカラー
  document.getElementById('custom-color').addEventListener('input', (e) => {
    const color = e.target.value;
    document.querySelectorAll('.color-dot').forEach((d) => d.classList.remove('active'));
    drawingEngines.forEach((engine) => {
      engine.color = color;
    });
  });

  // 線の太さ
  const lineWidthInput = document.getElementById('line-width');
  const lineWidthLabel = document.getElementById('line-width-label');
  lineWidthInput.addEventListener('input', () => {
    const width = parseInt(lineWidthInput.value);
    lineWidthLabel.textContent = width;
    drawingEngines.forEach((engine) => {
      engine.lineWidth = width;
    });
  });

  // Undo/Redo
  document.getElementById('btn-undo').addEventListener('click', () => {
    const engine = drawingEngines.get(currentPage);
    if (engine) engine.undo();
  });
  document.getElementById('btn-redo').addEventListener('click', () => {
    const engine = drawingEngines.get(currentPage);
    if (engine) engine.redo();
  });

  // キーボードショートカット
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      const engine = drawingEngines.get(currentPage);
      if (engine) engine.undo();
    }
    if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      const engine = drawingEngines.get(currentPage);
      if (engine) engine.redo();
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      navigatePage(-1);
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      navigatePage(1);
    }
  });

  // ズーム
  document.getElementById('btn-zoom-in').addEventListener('click', () => changeZoom(0.15));
  document.getElementById('btn-zoom-out').addEventListener('click', () => changeZoom(-0.15));
  zoomResetBtn.addEventListener('click', () => {
    scale = 1.0;
    updateZoomDisplay();
    renderPages();
  });

  // マウスホイールズーム (Ctrl+ホイール)
  viewerMain.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      changeZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }
  }, { passive: false });

  // 見開き表示
  document.getElementById('btn-spread').addEventListener('click', () => {
    isSpreadView = !isSpreadView;
    const btn = document.getElementById('btn-spread');
    if (isSpreadView) {
      btn.classList.add('active');
      btn.classList.remove('text-gray-500');
      // 見開き時は奇数ページに揃える（左ページ=奇数、右=偶数）
      if (currentPage % 2 === 0) {
        currentPage = Math.max(1, currentPage - 1);
        pageInput.value = currentPage;
      }
    } else {
      btn.classList.remove('active');
      btn.classList.add('text-gray-500');
    }
    updatePageNavButtons();
    renderPages();
  });

  // 白紙ページ追加
  document.getElementById('btn-add-page').addEventListener('click', addBlankPage);

  // エクスポート
  document.getElementById('btn-export').addEventListener('click', exportAnnotatedPdf);

  // ページナビゲーション
  document.getElementById('btn-prev-page').addEventListener('click', () => navigatePage(-1));
  document.getElementById('btn-next-page').addEventListener('click', () => navigatePage(1));

  pageInput.addEventListener('change', () => {
    const page = parseInt(pageInput.value);
    if (page >= 1 && page <= totalPages) {
      goToPage(page);
    } else {
      pageInput.value = currentPage;
    }
  });
}

// === ページナビゲーション ===
async function navigatePage(delta) {
  const step = isSpreadView ? 2 : 1;
  const newPage = currentPage + delta * step;
  if (newPage >= 1 && newPage <= totalPages) {
    await goToPage(newPage);
  }
}

async function goToPage(pageNum) {
  // 現在のページのアノテーションを保存
  await saveAllAnnotations();

  currentPage = pageNum;
  pageInput.value = currentPage;
  updatePageNavButtons();
  await renderPages();
}

function updatePageNavButtons() {
  const step = isSpreadView ? 2 : 1;
  document.getElementById('btn-prev-page').disabled = currentPage <= 1;
  document.getElementById('btn-next-page').disabled = currentPage + step > totalPages;
}

// === ズーム ===
function changeZoom(delta) {
  const newScale = Math.max(0.25, Math.min(4.0, scale + delta));
  if (newScale === scale) return;
  scale = newScale;
  updateZoomDisplay();
  renderPages();
}

function updateZoomDisplay() {
  zoomResetBtn.textContent = `${Math.round(scale * 100)}%`;
}

// === 白紙ページ追加 ===
async function addBlankPage() {
  totalPages += 1;
  extraBlankPages += 1;
  pageTotal.textContent = totalPages;
  pageInput.max = totalPages;

  // ドキュメントのページ数を更新
  docData.pageCount = totalPages;
  await saveDocument(docData);

  // 追加したページに移動
  await goToPage(totalPages);
}

// === アノテーション保存 ===
async function saveAllAnnotations() {
  const promises = [];
  drawingEngines.forEach((engine, pageNum) => {
    const strokes = engine.getStrokes();
    if (strokes.length > 0) {
      promises.push(saveAnnotation(docId, pageNum, strokes));
    }
  });
  if (promises.length > 0) {
    showSaving();
    await Promise.all(promises);
    showSaved();
  }
}

// === 保存インジケーター ===
function showSaving() {
  saveIndicator.classList.remove('hidden');
  saveIndicator.classList.add('saving');
  saveIndicator.querySelector('.saved').classList.add('hidden');
  saveIndicator.querySelector('.saving').classList.remove('hidden');
}

function showSaved() {
  saveIndicator.classList.remove('saving');
  saveIndicator.querySelector('.saving').classList.add('hidden');
  saveIndicator.querySelector('.saved').classList.remove('hidden');

  // 3秒後に非表示
  setTimeout(() => {
    saveIndicator.classList.add('hidden');
  }, 3000);
}

// === PDF書き出し ===
async function exportAnnotatedPdf() {
  // 全ページのアノテーションを保存
  await saveAllAnnotations();

  // 各ページをcanvasに統合してダウンロード用画像を生成
  // jsPDFを動的にロード
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
  document.head.appendChild(script);

  await new Promise((resolve) => (script.onload = resolve));

  const { jsPDF } = window.jspdf;

  // 最初のページのサイズを取得
  let defaultWidth = 595;
  let defaultHeight = 842;
  if (pdfRenderer && pdfRenderer.pageCount > 0) {
    const size = await pdfRenderer.getPageSize(1);
    defaultWidth = size.width;
    defaultHeight = size.height;
  }

  const pdf = new jsPDF({
    orientation: defaultWidth > defaultHeight ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [defaultWidth, defaultHeight],
  });

  for (let i = 1; i <= totalPages; i++) {
    if (i > 1) pdf.addPage([defaultWidth, defaultHeight]);

    // 一時キャンバスにPDF + アノテーションを統合
    const tempCanvas = document.createElement('canvas');
    const origPageCount = pdfRenderer ? pdfRenderer.pageCount : 0;
    const isBlank = i > origPageCount;

    if (isBlank) {
      tempCanvas.width = defaultWidth;
      tempCanvas.height = defaultHeight;
      const ctx = tempCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, defaultWidth, defaultHeight);
      // 罫線
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 0.5;
      const lineSpacing = 28;
      for (let y = lineSpacing; y < defaultHeight; y += lineSpacing) {
        ctx.beginPath();
        ctx.moveTo(20, y);
        ctx.lineTo(defaultWidth - 20, y);
        ctx.stroke();
      }
    } else {
      await pdfRenderer.renderPage(i, tempCanvas, 1.0);
    }

    // アノテーションを重ねる
    const annotation = await getAnnotation(docId, i);
    if (annotation && annotation.strokes) {
      const ctx = tempCanvas.getContext('2d');
      for (const stroke of annotation.strokes) {
        if (stroke.points.length === 0) continue;
        ctx.save();
        ctx.globalAlpha = stroke.opacity;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (stroke.tool === 'highlighter') {
          ctx.globalCompositeOperation = 'multiply';
        }

        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let j = 1; j < stroke.points.length - 1; j++) {
          const cp = stroke.points[j];
          const next = stroke.points[j + 1];
          const mx = (cp.x + next.x) / 2;
          const my = (cp.y + next.y) / 2;
          ctx.quadraticCurveTo(cp.x, cp.y, mx, my);
        }
        if (stroke.points.length > 1) {
          const last = stroke.points[stroke.points.length - 1];
          ctx.lineTo(last.x, last.y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    const imgData = tempCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', 0, 0, defaultWidth, defaultHeight);
  }

  pdf.save(`${docData.name}.pdf`);
}

// === App起動 ===
init().then(() => {
  updatePageNavButtons();
});

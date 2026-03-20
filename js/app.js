// ファイルマネージャー アプリケーションロジック

import {
  initDB,
  createFolder,
  getFolders,
  renameFolder,
  deleteFolder,
  getFolder,
  saveDocument,
  getDocuments,
  getDocument,
  deleteDocument,
  renameDocument,
} from './storage.js';
import { formatDate } from './utils.js';
import { PdfRenderer } from './pdf-renderer.js';

// === 状態管理 ===
let currentFolderId = null; // 現在のフォルダID (null = ルート)
let folderPath = []; // パンくず用パス [{id, name}, ...]
let contextTarget = null; // 右クリック対象 {type, id}

// === DOM要素 ===
const breadcrumb = document.getElementById('breadcrumb');
const foldersSection = document.getElementById('folders-section');
const foldersGrid = document.getElementById('folders-grid');
const documentsSection = document.getElementById('documents-section');
const documentsGrid = document.getElementById('documents-grid');
const emptyState = document.getElementById('empty-state');
const contextMenu = document.getElementById('context-menu');
const renameModal = document.getElementById('rename-modal');
const renameInput = document.getElementById('rename-input');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const folderModal = document.getElementById('folder-modal');
const folderInput = document.getElementById('folder-input');

// === 初期化 ===
async function init() {
  await initDB();
  await renderCurrentFolder();
  bindEvents();
}

// === イベントバインド ===
function bindEvents() {
  // PDFアップロード
  document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
  document.getElementById('btn-empty-upload')?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileUpload);

  // 白紙ノート作成
  document.getElementById('btn-new-blank').addEventListener('click', createBlankNote);
  document.getElementById('btn-empty-blank')?.addEventListener('click', createBlankNote);

  // フォルダ作成
  document.getElementById('btn-new-folder').addEventListener('click', openFolderModal);

  // フォルダ作成モーダル
  document.getElementById('folder-cancel').addEventListener('click', closeFolderModal);
  document.getElementById('folder-confirm').addEventListener('click', confirmCreateFolder);
  folderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCreateFolder();
    if (e.key === 'Escape') closeFolderModal();
  });
  folderModal.addEventListener('click', (e) => {
    if (e.target === folderModal) closeFolderModal();
  });

  // コンテキストメニュー
  document.addEventListener('click', () => hideContextMenu());
  contextMenu.querySelectorAll('.ctx-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      handleContextAction(action);
    });
  });

  // リネームモーダル
  document.getElementById('rename-cancel').addEventListener('click', closeRenameModal);
  document.getElementById('rename-confirm').addEventListener('click', confirmRename);
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });
  renameModal.addEventListener('click', (e) => {
    if (e.target === renameModal) closeRenameModal();
  });

  // ドラッグ&ドロップ
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.remove('hidden');
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
    dropZone.classList.add('hidden');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    dropZone.classList.add('hidden');
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === 'application/pdf');
    if (files.length > 0) handleFiles(files);
  });
}

// === フォルダ描画 ===
async function renderCurrentFolder() {
  const folders = await getFolders(currentFolderId);
  const documents = await getDocuments(currentFolderId);

  // パンくず更新
  renderBreadcrumb();

  // フォルダ描画
  if (folders.length > 0) {
    foldersSection.classList.remove('hidden');
    foldersGrid.innerHTML = '';
    folders
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((folder) => {
        foldersGrid.appendChild(createFolderCard(folder));
      });
  } else {
    foldersSection.classList.add('hidden');
  }

  // ドキュメント描画
  if (documents.length > 0) {
    documentsSection.classList.remove('hidden');
    documentsGrid.innerHTML = '';
    documents
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((doc) => {
        documentsGrid.appendChild(createDocCard(doc));
      });
    emptyState.classList.add('hidden');
  } else {
    documentsGrid.innerHTML = '';
    if (folders.length === 0) {
      emptyState.classList.remove('hidden');
      documentsSection.classList.add('hidden');
    } else {
      emptyState.classList.add('hidden');
      documentsSection.classList.add('hidden');
    }
  }
}

function createFolderCard(folder) {
  const div = document.createElement('div');
  div.className = 'folder-card bg-white rounded-xl p-4 border border-gray-100 flex items-center gap-3 animate-fade-in';
  div.innerHTML = `
    <div class="text-2xl">📁</div>
    <div class="min-w-0">
      <p class="text-sm font-medium text-gray-800 truncate">${escapeHtml(folder.name)}</p>
      <p class="text-xs text-gray-400 mt-0.5">${formatDate(folder.updatedAt)}</p>
    </div>
  `;

  // クリックでフォルダに入る
  div.addEventListener('click', () => navigateToFolder(folder.id, folder.name));

  // 右クリック
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, 'folder', folder.id);
  });

  return div;
}

function createDocCard(doc) {
  const div = document.createElement('div');
  div.className = 'doc-card bg-white rounded-xl border border-gray-100 overflow-hidden animate-fade-in';

  const thumbnailHtml = doc.thumbnail
    ? `<img src="${doc.thumbnail}" alt="" class="w-full h-full object-cover">`
    : `<div class="w-full h-full flex items-center justify-center bg-gray-50">
        <svg class="w-12 h-12 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>`;

  const typeBadge = doc.type === 'blank'
    ? '<span class="px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-600 rounded font-medium">白紙</span>'
    : '<span class="px-1.5 py-0.5 text-[10px] bg-blue-50 text-blue-600 rounded font-medium">PDF</span>';

  div.innerHTML = `
    <div class="aspect-[3/4] overflow-hidden bg-gray-50">
      ${thumbnailHtml}
    </div>
    <div class="p-3">
      <div class="flex items-start justify-between gap-1">
        <p class="text-sm font-medium text-gray-800 truncate flex-1">${escapeHtml(doc.name)}</p>
        ${typeBadge}
      </div>
      <p class="text-xs text-gray-400 mt-1">${formatDate(doc.updatedAt)}</p>
    </div>
  `;

  // クリックでビューアーを開く
  div.addEventListener('click', () => openDocument(doc.id));

  // 右クリック
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, 'document', doc.id);
  });

  return div;
}

// === ナビゲーション ===
function navigateToFolder(folderId, folderName) {
  if (folderId !== null) {
    folderPath.push({ id: folderId, name: folderName });
  }
  currentFolderId = folderId;
  renderCurrentFolder();
}

function navigateUp(index) {
  if (index < 0) {
    // ルートに戻る
    currentFolderId = null;
    folderPath = [];
  } else {
    currentFolderId = folderPath[index].id;
    folderPath = folderPath.slice(0, index + 1);
  }
  renderCurrentFolder();
}

function renderBreadcrumb() {
  let html = `<button class="breadcrumb-item font-medium" data-nav-index="-1">📁 マイファイル</button>`;

  folderPath.forEach((folder, index) => {
    html += `
      <svg class="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>
      <button class="breadcrumb-item font-medium truncate max-w-[120px]" data-nav-index="${index}">
        ${escapeHtml(folder.name)}
      </button>
    `;
  });

  breadcrumb.querySelector('div').innerHTML = html;

  // イベントバインド
  breadcrumb.querySelectorAll('.breadcrumb-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateUp(parseInt(btn.dataset.navIndex));
    });
  });
}

function openDocument(docId) {
  window.location.href = `viewer.html?id=${docId}`;
}

// === ファイルアップロード ===
async function handleFileUpload(e) {
  const files = Array.from(e.target.files);
  await handleFiles(files);
  fileInput.value = '';
}

async function handleFiles(files) {
  for (const file of files) {
    if (file.type !== 'application/pdf') continue;

    const arrayBuffer = await file.arrayBuffer();

    // PDF情報取得とサムネイル生成
    const renderer = new PdfRenderer();
    const pageCount = await renderer.loadFromData(arrayBuffer.slice(0));
    let thumbnail = null;
    try {
      thumbnail = await renderer.generateThumbnail(1, 200);
    } catch (err) {
      console.warn('サムネイル生成失敗:', err);
    }
    renderer.destroy();

    await saveDocument({
      name: file.name.replace(/\.pdf$/i, ''),
      folderId: currentFolderId,
      type: 'pdf',
      pdfData: arrayBuffer,
      pageCount,
      thumbnail,
    });
  }

  await renderCurrentFolder();
}

// === 白紙ノート作成 ===
async function createBlankNote() {
  const name = `ノート ${formatDate(Date.now())}`;

  await saveDocument({
    name,
    folderId: currentFolderId,
    type: 'blank',
    pdfData: null,
    pageCount: 1,
  });

  await renderCurrentFolder();
}

// === フォルダ作成モーダル ===
function openFolderModal() {
  folderInput.value = '新しいフォルダ';
  folderModal.classList.remove('hidden');
  folderInput.focus();
  folderInput.select();
}

function closeFolderModal() {
  folderModal.classList.add('hidden');
}

async function confirmCreateFolder() {
  const name = folderInput.value.trim();
  if (!name) return;

  closeFolderModal();
  await createFolder(name, currentFolderId);
  await renderCurrentFolder();
}

// === コンテキストメニュー ===
function showContextMenu(e, type, id) {
  e.stopPropagation();
  contextTarget = { type, id };

  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.classList.remove('hidden');

  // 画面外に出ないように補正
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = `${window.innerWidth - rect.width - 8}px`;
  }
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = `${window.innerHeight - rect.height - 8}px`;
  }
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
  contextTarget = null;
}

async function handleContextAction(action) {
  if (!contextTarget) return;
  const { type, id } = contextTarget;
  hideContextMenu();

  switch (action) {
    case 'open':
      if (type === 'folder') {
        const folder = await getFolder(id);
        if (folder) navigateToFolder(id, folder.name);
      } else {
        openDocument(id);
      }
      break;

    case 'rename':
      openRenameModal(type, id);
      break;

    case 'delete':
      if (confirm('削除してもよろしいですか？')) {
        if (type === 'folder') {
          await deleteFolder(id);
        } else {
          await deleteDocument(id);
        }
        await renderCurrentFolder();
      }
      break;
  }
}

// === リネームモーダル ===
let renameTarget = null;

async function openRenameModal(type, id) {
  renameTarget = { type, id };
  let currentName = '';

  if (type === 'folder') {
    const folder = await getFolder(id);
    currentName = folder?.name || '';
  } else {
    const doc = await getDocument(id);
    currentName = doc?.name || '';
  }

  renameInput.value = currentName;
  renameModal.classList.remove('hidden');
  renameInput.focus();
  renameInput.select();
}

function closeRenameModal() {
  renameModal.classList.add('hidden');
  renameTarget = null;
}

async function confirmRename() {
  if (!renameTarget) return;
  const newName = renameInput.value.trim();
  if (!newName) return;

  if (renameTarget.type === 'folder') {
    await renameFolder(renameTarget.id, newName);
  } else {
    await renameDocument(renameTarget.id, newName);
  }

  closeRenameModal();
  await renderCurrentFolder();
}

// === ヘルパー ===
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === アプリ起動 ===
init();

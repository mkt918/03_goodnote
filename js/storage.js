// IndexedDB ストレージ管理モジュール

import { generateId } from './utils.js';

const DB_NAME = 'goodnote-db';
const DB_VERSION = 1;

let db = null;

/**
 * データベースを初期化
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // フォルダストア
      if (!database.objectStoreNames.contains('folders')) {
        const folderStore = database.createObjectStore('folders', { keyPath: 'id' });
        folderStore.createIndex('parentId', 'parentId', { unique: false });
        folderStore.createIndex('name', 'name', { unique: false });
      }

      // ドキュメントストア
      if (!database.objectStoreNames.contains('documents')) {
        const docStore = database.createObjectStore('documents', { keyPath: 'id' });
        docStore.createIndex('folderId', 'folderId', { unique: false });
        docStore.createIndex('name', 'name', { unique: false });
      }

      // アノテーションストア
      if (!database.objectStoreNames.contains('annotations')) {
        const annoStore = database.createObjectStore('annotations', { keyPath: 'id' });
        annoStore.createIndex('documentId', 'documentId', { unique: false });
        annoStore.createIndex('docPage', ['documentId', 'pageNumber'], { unique: true });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// ===== フォルダ操作 =====

/**
 * フォルダを作成
 * @param {string} name - フォルダ名
 * @param {string|null} parentId - 親フォルダID (nullならルート)
 * @returns {Promise<Object>} 作成されたフォルダ
 */
export async function createFolder(name, parentId = null) {
  const database = await initDB();
  const folder = {
    id: generateId(),
    name,
    parentId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = database.transaction('folders', 'readwrite');
    tx.objectStore('folders').add(folder);
    tx.oncomplete = () => resolve(folder);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 指定した親フォルダ内のフォルダ一覧を取得
 * @param {string|null} parentId - 親フォルダID
 * @returns {Promise<Array>}
 */
export async function getFolders(parentId = null) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('folders', 'readonly');
    const store = tx.objectStore('folders');
    // IndexedDBはnullキーをインデックスで検索できないため全件取得してフィルタ
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result.filter(
        (f) => (parentId === null || parentId === undefined)
          ? (f.parentId === null || f.parentId === undefined)
          : f.parentId === parentId
      );
      resolve(results);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * フォルダ名を更新
 * @param {string} folderId
 * @param {string} newName
 * @returns {Promise<void>}
 */
export async function renameFolder(folderId, newName) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    const request = store.get(folderId);
    request.onsuccess = () => {
      const folder = request.result;
      if (folder) {
        folder.name = newName;
        folder.updatedAt = Date.now();
        store.put(folder);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * フォルダを削除（中身も含めて再帰的に）
 * @param {string} folderId
 * @returns {Promise<void>}
 */
export async function deleteFolder(folderId) {
  // サブフォルダを再帰削除
  const subFolders = await getFolders(folderId);
  for (const sub of subFolders) {
    await deleteFolder(sub.id);
  }

  // フォルダ内のドキュメントを削除
  const docs = await getDocuments(folderId);
  for (const doc of docs) {
    await deleteDocument(doc.id);
  }

  // フォルダ自体を削除
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('folders', 'readwrite');
    tx.objectStore('folders').delete(folderId);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * フォルダを取得
 * @param {string} folderId
 * @returns {Promise<Object|null>}
 */
export async function getFolder(folderId) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('folders', 'readonly');
    const request = tx.objectStore('folders').get(folderId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

// ===== ドキュメント操作 =====

/**
 * ドキュメントを保存
 * @param {Object} docData - {名前, folderId, type, pdfData, pageCount}
 * @returns {Promise<Object>}
 */
export async function saveDocument(docData) {
  const database = await initDB();
  const doc = {
    id: docData.id || generateId(),
    folderId: docData.folderId || null,
    name: docData.name,
    type: docData.type || 'pdf', // 'pdf' or 'blank'
    pdfData: docData.pdfData || null, // ArrayBuffer
    pageCount: docData.pageCount || 1,
    thumbnail: docData.thumbnail || null,
    createdAt: docData.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = database.transaction('documents', 'readwrite');
    tx.objectStore('documents').put(doc);
    tx.oncomplete = () => resolve(doc);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 指定フォルダ内のドキュメント一覧を取得
 * @param {string|null} folderId
 * @returns {Promise<Array>}
 */
export async function getDocuments(folderId = null) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    // IndexedDBはnullキーをインデックスで検索できないため全件取得してフィルタ
    const request = store.getAll();
    request.onsuccess = () => {
      const results = request.result.filter(
        (d) => (folderId === null || folderId === undefined)
          ? (d.folderId === null || d.folderId === undefined)
          : d.folderId === folderId
      );
      resolve(results);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * ドキュメントを取得
 * @param {string} docId
 * @returns {Promise<Object|null>}
 */
export async function getDocument(docId) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('documents', 'readonly');
    const request = tx.objectStore('documents').get(docId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * ドキュメントを削除（関連アノテーションも）
 * @param {string} docId
 * @returns {Promise<void>}
 */
export async function deleteDocument(docId) {
  // 関連アノテーションも削除
  const annotations = await getAnnotationsByDocument(docId);
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(['documents', 'annotations'], 'readwrite');

    // アノテーション削除
    const annoStore = tx.objectStore('annotations');
    for (const anno of annotations) {
      annoStore.delete(anno.id);
    }

    // ドキュメント削除
    tx.objectStore('documents').delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * ドキュメント名を変更
 * @param {string} docId
 * @param {string} newName
 * @returns {Promise<void>}
 */
export async function renameDocument(docId, newName) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (doc) {
        doc.name = newName;
        doc.updatedAt = Date.now();
        store.put(doc);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * ドキュメントを別フォルダへ移動
 * @param {string} docId
 * @param {string|null} newFolderId
 * @returns {Promise<void>}
 */
export async function moveDocument(docId, newFolderId) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (doc) {
        doc.folderId = newFolderId;
        doc.updatedAt = Date.now();
        store.put(doc);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ===== アノテーション操作 =====

/**
 * ページのアノテーションを保存（上書き）
 * @param {string} documentId
 * @param {number} pageNumber
 * @param {Array} strokes - ストローク配列
 * @returns {Promise<Object>}
 */
export async function saveAnnotation(documentId, pageNumber, strokes) {
  const database = await initDB();

  // 既存のアノテーションを検索
  const existing = await getAnnotation(documentId, pageNumber);

  const annotation = {
    id: existing ? existing.id : generateId(),
    documentId,
    pageNumber,
    strokes,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = database.transaction('annotations', 'readwrite');
    tx.objectStore('annotations').put(annotation);
    tx.oncomplete = () => resolve(annotation);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 特定ページのアノテーションを取得
 * @param {string} documentId
 * @param {number} pageNumber
 * @returns {Promise<Object|null>}
 */
export async function getAnnotation(documentId, pageNumber) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('annotations', 'readonly');
    const index = tx.objectStore('annotations').index('docPage');
    const request = index.get([documentId, pageNumber]);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * ドキュメントの全アノテーションを取得
 * @param {string} documentId
 * @returns {Promise<Array>}
 */
export async function getAnnotationsByDocument(documentId) {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('annotations', 'readonly');
    const index = tx.objectStore('annotations').index('documentId');
    const request = index.getAll(documentId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 全データをエクスポート（バックアップ用）
 * @returns {Promise<Object>}
 */
export async function exportAllData() {
  const database = await initDB();

  const getAll = (storeName) =>
    new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });

  return {
    folders: await getAll('folders'),
    documents: await getAll('documents'),
    annotations: await getAll('annotations'),
    exportedAt: Date.now(),
  };
}

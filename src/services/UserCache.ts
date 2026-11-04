import type { UserPage } from '../models/UserModel';

interface CachedPage extends UserPage {
  key: string;
  accountId: number;
}

const DATABASE_NAME = 'sqlite-browser-cache';
const STORE_NAME = 'user-pages';
const DATABASE_VERSION = 1;

export class UserCache {
  private static open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB cache'));
    });
  }

  private static cacheKey(accountId: number, query: string, page: number, pageSize: number): string {
    return `${accountId}:${page}:${pageSize}:${query.toLocaleLowerCase()}`;
  }

  static async read(accountId: number, query: string, page: number, pageSize: number): Promise<UserPage | null> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(this.cacheKey(accountId, query, page, pageSize));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Unable to read IndexedDB cache'));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to read IndexedDB cache'));
    });
  }

  static async write(accountId: number, query: string, page: number, pageSize: number, data: UserPage): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const cached: CachedPage = {
        ...data,
        accountId,
        key: this.cacheKey(accountId, query, page, pageSize)
      };
      transaction.objectStore(STORE_NAME).put(cached);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Unable to write IndexedDB cache'));
      };
    });
  }

  static async clearAccount(accountId: number): Promise<void> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if ((cursor.value as CachedPage).accountId === accountId) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Unable to clear IndexedDB cache'));
      };
    });
  }
}

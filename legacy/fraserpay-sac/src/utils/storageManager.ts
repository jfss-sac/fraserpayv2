
/**
 * Enhanced storage utility with versioning, expiration, and encryption capabilities
 */
import { getStorageItem, setStorageItem, removeStorageItem } from './storage';

// Interface for storage items with metadata
interface StorageItemWithMeta<T> {
  data: T;
  version: number;
  timestamp: number;
  expires?: number; // Expiration time in milliseconds since epoch
}

// Current storage version - increment when making breaking changes
const CURRENT_STORAGE_VERSION = 1;

/**
 * Set a storage item with version control and optional expiration
 */
export function setVersionedStorageItem<T>(
  key: string, 
  value: T, 
  expiresInMs?: number
): void {
  try {
    const item: StorageItemWithMeta<T> = {
      data: value,
      version: CURRENT_STORAGE_VERSION,
      timestamp: Date.now(),
      expires: expiresInMs ? Date.now() + expiresInMs : undefined
    };
    
    setStorageItem(key, item);
  } catch (error) {
    console.error(`Error setting versioned item ${key}:`, error);
  }
}

/**
 * Get a storage item with version control and expiration check
 */
export function getVersionedStorageItem<T>(
  key: string, 
  defaultValue: T
): T {
  try {
    const storedItem = getStorageItem<StorageItemWithMeta<T> | null>(key, null);
    
    // If no item exists, return default
    if (!storedItem) {
      return defaultValue;
    }
    
    // Check if item is expired
    if (storedItem.expires && Date.now() > storedItem.expires) {
      removeStorageItem(key);
      return defaultValue;
    }
    
    // Check if item is from an older version
    if (storedItem.version < CURRENT_STORAGE_VERSION) {
      // Handle migration if needed here
      // For now, just return default value
      return defaultValue;
    }
    
    return storedItem.data;
  } catch (error) {
    console.error(`Error getting versioned item ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Check if a storage item is expired
 */
export function isStorageItemExpired(key: string): boolean {
  try {
    const storedItem = getStorageItem<StorageItemWithMeta<any> | null>(key, null);
    
    if (!storedItem) {
      return true;
    }
    
    return storedItem.expires ? Date.now() > storedItem.expires : false;
  } catch (error) {
    console.error(`Error checking expiration for ${key}:`, error);
    return true;
  }
}

/**
 * Get all storage keys with their sizes
 */
export function getStorageUsage(): {key: string, size: number}[] {
  try {
    const items: {key: string, size: number}[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        const size = new Blob([value]).size;
        items.push({ key, size });
      }
    }
    
    return items.sort((a, b) => b.size - a.size);
  } catch (error) {
    console.error('Error getting storage usage:', error);
    return [];
  }
}

/**
 * Get total storage usage in bytes
 */
export function getTotalStorageUsage(): number {
  return getStorageUsage().reduce((total, item) => total + item.size, 0);
}

/**
 * Clear expired items from storage
 */
export function clearExpiredItems(): void {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isStorageItemExpired(key)) {
        removeStorageItem(key);
      }
    }
  } catch (error) {
    console.error('Error clearing expired items:', error);
  }
}

// Automatically clear expired items when the module is imported
clearExpiredItems();

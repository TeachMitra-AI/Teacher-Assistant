// Cache Manager - Offline-First Functionality

class CacheManager {
  constructor() {
    this.db = null;
    this.dbName = CONFIG.CACHE.DB_NAME;
    this.dbVersion = CONFIG.CACHE.DB_VERSION;
    this.storeName = CONFIG.CACHE.STORE_NAME;
    this.initialized = false;
    this.offlineQueue = [];
    
    this.init();
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    if (!CONFIG.CACHE.ENABLED) {
      console.log('Cache is disabled');
      return;
    }

    try {
      this.db = await this.openDatabase();
      this.initialized = true;
      console.log('Cache Manager initialized successfully');
      
      // Load offline queue from localStorage
      this.loadOfflineQueue();
      
      // Process offline queue if online
      if (navigator.onLine) {
        this.processOfflineQueue();
      }
      
      // Listen for online/offline events
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
      
    } catch (error) {
      console.error('Failed to initialize Cache Manager:', error);
    }
  }

  /**
   * Open IndexedDB database
   */
  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
          objectStore.createIndex('queryHash', 'queryHash', { unique: false });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          objectStore.createIndex('language', 'language', { unique: false });
        }
      };
    });
  }

  /**
   * Generate hash for query (for cache lookup)
   */
  generateQueryHash(query, context) {
    const normalized = query.toLowerCase().trim();
    const contextStr = JSON.stringify(context);
    return btoa(normalized + contextStr).substring(0, 50);
  }

  /**
   * Check if response is cached
   */
  async getCachedResponse(query, context, language) {
    if (!this.initialized) return null;

    try {
      const queryHash = this.generateQueryHash(query, context);
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const index = objectStore.index('queryHash');
      
      return new Promise((resolve, reject) => {
        const request = index.getAll(queryHash);
        
        request.onsuccess = () => {
          const results = request.result;
          
          // Find matching result with same language
          const match = results.find(r => 
            r.language === language && 
            !this.isCacheExpired(r.timestamp)
          );
          
          if (match) {
            console.log('Cache hit:', queryHash);
            resolve(match.response);
          } else {
            console.log('Cache miss:', queryHash);
            resolve(null);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
      
    } catch (error) {
      console.error('Error checking cache:', error);
      return null;
    }
  }

  /**
   * Save response to cache
   */
  async cacheResponse(query, context, language, response) {
    if (!this.initialized) return;

    try {
      const queryHash = this.generateQueryHash(query, context);
      const cacheEntry = {
        queryHash: queryHash,
        query: query,
        context: context,
        language: language,
        response: response,
        timestamp: new Date().toISOString()
      };

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      
      await objectStore.add(cacheEntry);
      console.log('Response cached:', queryHash);
      
      // Clean up old cache entries
      this.cleanupCache();
      
    } catch (error) {
      console.error('Error caching response:', error);
    }
  }

  /**
   * Check if cache entry is expired
   */
  isCacheExpired(timestamp) {
    const expiryMs = CONFIG.CACHE.EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const entryTime = new Date(timestamp).getTime();
    const now = Date.now();
    return (now - entryTime) > expiryMs;
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupCache() {
    if (!this.initialized) return;

    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      const index = objectStore.index('timestamp');
      
      const request = index.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (this.isCacheExpired(cursor.value.timestamp)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      
    } catch (error) {
      console.error('Error cleaning cache:', error);
    }
  }

  /**
   * Add query to offline queue
   */
  addToOfflineQueue(query, context, language) {
    const queueItem = {
      id: Date.now(),
      query: query,
      context: context,
      language: language,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    this.offlineQueue.push(queueItem);
    this.saveOfflineQueue();
    
    console.log('Query added to offline queue:', queueItem.id);
    
    // Track analytics
    if (CONFIG.FEATURES.ANALYTICS) {
      aiService.trackAnalytics({
        event: CONFIG.ANALYTICS.OFFLINE_QUERY,
        query: query,
        timestamp: queueItem.timestamp
      });
    }
    
    return queueItem.id;
  }

  /**
   * Save offline queue to localStorage
   */
  saveOfflineQueue() {
    try {
      localStorage.setItem('offlineQueue', JSON.stringify(this.offlineQueue));
    } catch (error) {
      console.error('Error saving offline queue:', error);
    }
  }

  /**
   * Load offline queue from localStorage
   */
  loadOfflineQueue() {
    try {
      const saved = localStorage.getItem('offlineQueue');
      if (saved) {
        this.offlineQueue = JSON.parse(saved);
        console.log(`Loaded ${this.offlineQueue.length} items from offline queue`);
      }
    } catch (error) {
      console.error('Error loading offline queue:', error);
      this.offlineQueue = [];
    }
  }

  /**
   * Process offline queue when back online
   */
  async processOfflineQueue() {
    if (this.offlineQueue.length === 0) return;

    console.log(`Processing ${this.offlineQueue.length} offline queries...`);
    
    const pendingItems = this.offlineQueue.filter(item => item.status === 'pending');
    
    for (const item of pendingItems) {
      try {
        // Generate response
        const response = await aiService.generateResponse(item.query, item.context, item.language);
        
        if (response.success) {
          // Cache the response
          await this.cacheResponse(item.query, item.context, item.language, response);
          
          // Mark as processed
          item.status = 'processed';
          item.processedAt = new Date().toISOString();
          
          // Notify user (if callback is set)
          if (window.onOfflineQueryProcessed) {
            window.onOfflineQueryProcessed(item, response);
          }
        } else {
          item.status = 'failed';
          item.error = response.error;
        }
        
      } catch (error) {
        console.error('Error processing offline query:', error);
        item.status = 'failed';
        item.error = error.message;
      }
    }
    
    // Remove processed items older than 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    this.offlineQueue = this.offlineQueue.filter(item => {
      if (item.status === 'processed' || item.status === 'failed') {
        const itemTime = new Date(item.timestamp).getTime();
        return itemTime > oneDayAgo;
      }
      return true; // Keep pending items
    });
    
    this.saveOfflineQueue();
  }

  /**
   * Handle online event
   */
  handleOnline() {
    console.log('Connection restored - processing offline queue');
    this.processOfflineQueue();
    
    // Notify UI
    if (window.onConnectionStatusChanged) {
      window.onConnectionStatusChanged(true);
    }
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    console.log('Connection lost - offline mode activated');
    
    // Notify UI
    if (window.onConnectionStatusChanged) {
      window.onConnectionStatusChanged(false);
    }
  }

  /**
   * Get offline queue status
   */
  getOfflineQueueStatus() {
    return {
      total: this.offlineQueue.length,
      pending: this.offlineQueue.filter(i => i.status === 'pending').length,
      processed: this.offlineQueue.filter(i => i.status === 'processed').length,
      failed: this.offlineQueue.filter(i => i.status === 'failed').length
    };
  }

  /**
   * Clear all cache
   */
  async clearCache() {
    if (!this.initialized) return;

    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      await objectStore.clear();
      console.log('Cache cleared');
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    if (!this.initialized) return null;

    try {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      
      return new Promise((resolve, reject) => {
        const countRequest = objectStore.count();
        
        countRequest.onsuccess = () => {
          resolve({
            totalEntries: countRequest.result,
            offlineQueue: this.getOfflineQueueStatus(),
            isOnline: navigator.onLine
          });
        };
        
        countRequest.onerror = () => reject(countRequest.error);
      });
      
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return null;
    }
  }
}

// Create singleton instance
const cacheManager = new CacheManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CacheManager;
}

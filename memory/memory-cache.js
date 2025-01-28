import { logger } from '../utils/logger.js';

const DEFAULT_CACHE_SIZE = 1000;
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

export class MemoryCache {
    constructor(maxItems = 1500, maxSizeMB = 75) {
        this.cache = new Map();
        this.maxItems = maxItems;
        this.maxSizeMB = maxSizeMB;
        this.currentSizeBytes = 0;
        this.stats = {
            hits: 0,
            misses: 0,
            added: 0,
            removed: 0,
            currentItems: 0,
            maxItems: this.maxItems,
            maxSizeBytes: this.maxSizeMB * 1024 * 1024, // Convert MB to bytes
            currentSizeBytes: this.currentSizeBytes
        };
    }

    set(key, item) {
        const itemSize = JSON.stringify(item).length;

        // Enforce max size limit
        if (this.currentSizeBytes + itemSize > this.maxSizeMB * 1024 * 1024) {
            logger.warn('Memory cache limit reached (size), item not added', { key, itemSize, currentSize: this.currentSizeBytes, maxSize: this.maxSizeMB * 1024 * 1024 });
            this.stats.removed++; // Treat as removed due to limit
            return false;
        }
        // Enforce max items limit
        if (this.cache.size >= this.maxItems) {
            logger.warn('Memory cache limit reached (items), item not added', { key, currentItems: this.cache.size, maxItems: this.maxItems });
            this.stats.removed++; // Treat as removed due to limit
            return false;
        }

        this.cache.set(key, item);
        this.currentSizeBytes += itemSize;
        this.stats.added++;
        this.stats.currentItems = this.cache.size;
        this.stats.currentSizeBytes = this.currentSizeBytes;
        return true;
    }

    get(key) {
        if (this.cache.has(key)) {
            this.stats.hits++;
            return this.cache.get(key);
        } else {
            this.stats.misses++;
            return undefined;
        }
    }

    evictOldest() {
        let oldest = Infinity;
        let oldestKey = null;

        for (const [key, item] of this.cache.entries()) {
            if (item.lastAccessed < oldest) {
                oldest = item.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.stats.evictions++;
            logger.debug('Cache item evicted', { key: oldestKey });
        }
    }

    clear() {
        this.cache.clear();
        logger.info('Cache cleared');
    }

    getStats() {
        const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
        return {
            ...this.stats,
            size: this.cache.size,
            maxSize: this.maxSizeMB,
            hitRate: hitRate.toFixed(2)
        };
    }

    prewarm(keys, loader) {
        return Promise.all(
            keys.map(async key => {
                if (!this.get(key)) {
                    try {
                        const value = await loader(key);
                        this.set(key, value);
                    } catch (error) {
                        logger.error('Failed to prewarm cache item', { 
                            key, 
                            error: error.message 
                        });
                    }
                }
            })
        );
    }

    async getOrSet(key, loader, ttl = DEFAULT_TTL) {
        const cached = this.get(key);
        if (cached !== null) {
            return cached;
        }

        try {
            const value = await loader();
            this.set(key, value);
            return value;
        } catch (error) {
            logger.error('Cache loader failed', { 
                key, 
                error: error.message 
            });
            throw error;
        }
    }

    setMany(items, ttl = DEFAULT_TTL) {
        for (const [key, value] of Object.entries(items)) {
            this.set(key, value, ttl);
        }
    }

    getMany(keys) {
        const result = {};
        const missing = [];

        for (const key of keys) {
            const value = this.get(key);
            if (value !== null) {
                result[key] = value;
            } else {
                missing.push(key);
            }
        }

        return { found: result, missing };
    }

    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            logger.debug('Cache item deleted', { key });
        }
        return deleted;
    }

    has(key) {
        const item = this.cache.get(key);
        if (!item) return false;
        
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return false;
        }
        
        return true;
    }

    getAll() {
        const result = {};
        const now = Date.now();

        for (const [key, item] of this.cache.entries()) {
            if (now <= item.expiresAt) {
                result[key] = item.value;
            } else {
                this.cache.delete(key);
                this.stats.evictions++;
            }
        }

        return result;
    }
} 
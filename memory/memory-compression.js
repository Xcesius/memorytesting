import { logger } from '../utils/logger.js';
import { deflate, inflate } from 'zlib';
import { promisify } from 'util';

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

const COMPRESSION_THRESHOLD = 1024; // 1KB
const COMPRESSION_LEVEL = 9; // Max compression

export class MemoryCompression {
    constructor() {
        this.stats = {
            compressed: 0,
            decompressed: 0,
            savedBytes: 0
        };
    }

    async compress(data) {
        const jsonString = JSON.stringify(data);
        const originalSize = Buffer.from(jsonString).length;

        // Only compress if above threshold
        if (originalSize < COMPRESSION_THRESHOLD) {
            return {
                data: jsonString,
                compressed: false,
                originalSize,
                compressedSize: originalSize
            };
        }

        try {
            const compressed = await deflateAsync(jsonString, { level: COMPRESSION_LEVEL });
            const compressedSize = compressed.length;
            
            this.stats.compressed++;
            this.stats.savedBytes += originalSize - compressedSize;

            logger.debug('Memory compressed', {
                originalSize,
                compressedSize,
                ratio: (compressedSize / originalSize).toFixed(2)
            });

            return {
                data: compressed,
                compressed: true,
                originalSize,
                compressedSize
            };
        } catch (error) {
            logger.error('Compression failed', { error: error.message });
            return {
                data: jsonString,
                compressed: false,
                originalSize,
                compressedSize: originalSize
            };
        }
    }

    async decompress(data, isCompressed) {
        if (!isCompressed) {
            return JSON.parse(data);
        }

        try {
            const decompressed = await inflateAsync(data);
            const result = JSON.parse(decompressed.toString());
            
            this.stats.decompressed++;
            
            logger.debug('Memory decompressed', {
                size: decompressed.length
            });

            return result;
        } catch (error) {
            logger.error('Decompression failed', { error: error.message });
            throw error;
        }
    }

    async compressMemories(memories) {
        const compressed = {};
        let totalSaved = 0;

        for (const [id, memory] of Object.entries(memories)) {
            const result = await this.compress(memory);
            compressed[id] = {
                ...memory,
                data: result.data,
                compressed: result.compressed
            };
            totalSaved += result.originalSize - result.compressedSize;
        }

        logger.info('Batch compression complete', {
            count: Object.keys(memories).length,
            bytesSaved: totalSaved
        });

        return compressed;
    }

    async decompressMemories(memories) {
        const decompressed = {};

        for (const [id, memory] of Object.entries(memories)) {
            if (memory.compressed) {
                decompressed[id] = {
                    ...memory,
                    data: await this.decompress(memory.data, true)
                };
            } else {
                decompressed[id] = memory;
            }
        }

        return decompressed;
    }

    getStats() {
        return {
            ...this.stats,
            averageSavedBytes: this.stats.compressed ? 
                Math.round(this.stats.savedBytes / this.stats.compressed) : 0
        };
    }

    async optimizeStorage(memories, maxSize) {
        const originalSize = Buffer.from(JSON.stringify(memories)).length;
        if (originalSize <= maxSize) return memories;

        // First try compression
        const compressed = await this.compressMemories(memories);
        const compressedSize = Buffer.from(JSON.stringify(compressed)).length;

        if (compressedSize <= maxSize) {
            logger.info('Storage optimized through compression', {
                originalSize,
                compressedSize,
                reduction: ((originalSize - compressedSize) / originalSize * 100).toFixed(1) + '%'
            });
            return compressed;
        }

        // If still too large, we'll need to remove some memories
        logger.warn('Compression insufficient, some memories will be removed', {
            required: maxSize,
            current: compressedSize
        });

        return null; // Signal that pruning is needed
    }
} 
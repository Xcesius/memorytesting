import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const MAX_MEMORY_AGE_DAYS = 365; // Keep memories for a year
const MAX_MEMORY_SIZE_MB = 1024; // 1GB total memory limit
const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // Weekly cleanup

export class MemoryCleanup {
    constructor(memoryDir = 'memories') {
        this.memoryDir = memoryDir;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.scheduleCleanup();
        logger.info('Memory cleanup service started');
    }

    stop() {
        this.isRunning = false;
        logger.info('Memory cleanup service stopped');
    }

    scheduleCleanup() {
        if (!this.isRunning) return;
        
        this.cleanup()
            .then(() => {
                setTimeout(() => this.scheduleCleanup(), CLEANUP_INTERVAL_MS);
            })
            .catch(error => {
                logger.error('Memory cleanup failed', { error: error.message });
                setTimeout(() => this.scheduleCleanup(), CLEANUP_INTERVAL_MS);
            });
    }

    async cleanup() {
        try {
            await this.cleanupOldMemories();
            await this.enforceMemoryLimit();
            logger.info('Memory cleanup completed');
        } catch (error) {
            logger.error('Memory cleanup error', { error: error.message });
            throw error;
        }
    }

    async cleanupOldMemories() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - MAX_MEMORY_AGE_DAYS);

        const files = fs.readdirSync(this.memoryDir);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const filePath = path.join(this.memoryDir, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime < cutoffDate) {
                fs.unlinkSync(filePath);
                logger.info('Removed old memory file', { file });
            }
        }
    }

    async enforceMemoryLimit() {
        const files = fs.readdirSync(this.memoryDir)
            .filter(file => file.endsWith('.json'))
            .map(file => ({
                name: file,
                path: path.join(this.memoryDir, file),
                size: fs.statSync(path.join(this.memoryDir, file)).size
            }))
            .sort((a, b) => b.size - a.size);

        let totalSize = files.reduce((sum, file) => sum + file.size, 0);
        const maxSize = MAX_MEMORY_SIZE_MB * 1024 * 1024;

        while (totalSize > maxSize && files.length > 0) {
            const file = files.pop();
            fs.unlinkSync(file.path);
            totalSize -= file.size;
            logger.info('Removed large memory file', { file: file.name, size: file.size });
        }
    }
} 
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const MAX_RETRIES = 3;
const BACKUP_DIR = 'backups';
const RECOVERY_LOG = 'recovery_state.json';

if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
}

export class ErrorRecovery {
    constructor() {
        this.retryCount = new Map();
        this.recoveryState = this.loadRecoveryState();
    }

    loadRecoveryState() {
        try {
            const statePath = path.join(BACKUP_DIR, RECOVERY_LOG);
            if (fs.existsSync(statePath)) {
                return JSON.parse(fs.readFileSync(statePath, 'utf8'));
            }
        } catch (error) {
            logger.error('Failed to load recovery state', { error: error.message });
        }
        return { pendingOperations: [] };
    }

    saveRecoveryState() {
        try {
            fs.writeFileSync(
                path.join(BACKUP_DIR, RECOVERY_LOG),
                JSON.stringify(this.recoveryState)
            );
        } catch (error) {
            logger.error('Failed to save recovery state', { error: error.message });
        }
    }

    async backupMemoryFile(filePath) {
        try {
            const backupPath = path.join(BACKUP_DIR, path.basename(filePath) + '.bak');
            fs.copyFileSync(filePath, backupPath);
            logger.info('Memory backup created', { file: filePath });
            return backupPath;
        } catch (error) {
            logger.error('Backup failed', { error: error.message });
            throw error;
        }
    }

    async restoreFromBackup(backupPath, targetPath) {
        try {
            fs.copyFileSync(backupPath, targetPath);
            logger.info('Restored from backup', { file: targetPath });
            return true;
        } catch (error) {
            logger.error('Restore failed', { error: error.message });
            return false;
        }
    }

    async withRecovery(operation, context) {
        const opKey = JSON.stringify(context);
        const retries = this.retryCount.get(opKey) || 0;

        if (retries >= MAX_RETRIES) {
            logger.error('Max retries exceeded', context);
            this.retryCount.delete(opKey);
            throw new Error('Operation failed after max retries');
        }

        try {
            // Backup before operation if it involves file changes
            if (context.filePath) {
                const backupPath = await this.backupMemoryFile(context.filePath);
                this.recoveryState.pendingOperations.push({
                    backupPath,
                    targetPath: context.filePath,
                    timestamp: Date.now()
                });
                this.saveRecoveryState();
            }

            const result = await operation();

            // Cleanup after successful operation
            if (context.filePath) {
                this.recoveryState.pendingOperations = 
                    this.recoveryState.pendingOperations.filter(op => 
                        op.targetPath !== context.filePath
                    );
                this.saveRecoveryState();
            }

            this.retryCount.delete(opKey);
            return result;

        } catch (error) {
            this.retryCount.set(opKey, retries + 1);
            logger.error('Operation failed, attempting recovery', {
                error: error.message,
                retry: retries + 1,
                context
            });

            // Attempt recovery if we have a backup
            if (context.filePath) {
                const pendingOp = this.recoveryState.pendingOperations
                    .find(op => op.targetPath === context.filePath);
                
                if (pendingOp && await this.restoreFromBackup(pendingOp.backupPath, pendingOp.targetPath)) {
                    return this.withRecovery(operation, context);
                }
            }

            throw error;
        }
    }

    // Cleanup old backups periodically
    async cleanupOldBackups(maxAge = 24 * 60 * 60 * 1000) { // 24 hours
        const files = fs.readdirSync(BACKUP_DIR);
        const now = Date.now();

        for (const file of files) {
            if (!file.endsWith('.bak')) continue;

            const filePath = path.join(BACKUP_DIR, file);
            const stats = fs.statSync(filePath);
            
            if (now - stats.mtimeMs > maxAge) {
                try {
                    fs.unlinkSync(filePath);
                    logger.debug('Removed old backup', { file });
                } catch (error) {
                    logger.warn('Failed to remove old backup', { file, error: error.message });
                }
            }
        }
    }
} 
import fs from 'fs';
import path from 'path';

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

const LOG_DIR = 'logs';
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES = 5;

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

function rotateLogFile(logFile) {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_SIZE) {
        for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
            const oldFile = `${logFile}.${i}`;
            const newFile = `${logFile}.${i + 1}`;
            if (fs.existsSync(oldFile)) {
                fs.renameSync(oldFile, newFile);
            }
        }
        fs.renameSync(logFile, `${logFile}.1`);
    }
}

function formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}\n`;
}

function log(level, message, meta = {}) {
    const logFile = path.join(LOG_DIR, 'app.log');
    rotateLogFile(logFile);
    
    const logMessage = formatMessage(level, message, meta);
    fs.appendFileSync(logFile, logMessage);
    
    if (process.env.NODE_ENV !== 'production') {
        console.log(logMessage);
    }
}

export const logger = {
    error: (message, meta) => log(LOG_LEVELS.ERROR, message, meta),
    warn: (message, meta) => log(LOG_LEVELS.WARN, message, meta),
    info: (message, meta) => log(LOG_LEVELS.INFO, message, meta),
    debug: (message, meta) => log(LOG_LEVELS.DEBUG, message, meta)
}; 
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { EncryptionManager } from './encryption.js';
import { logger } from '../utils/logger.js';

const encryptor = new EncryptionManager(process.env.MASTER_KEY);

function deriveKey(key) {
    return crypto.createHash('sha256').update(String(key)).digest();
}

export function loadMemory(memoryFile, encryptionKey) {
    logger.debug('Loading memory file...', { filePath: memoryFile });

    // ISOLATED DECRYPTION TEST - REMOVED
    // if (encryptionKey) {
    //     logger.debug('--- STARTING ISOLATED DECRYPTION TEST ---');
    //     const testIvHex = "0b9521d7f86648acba510bf449b727d4"; // Use the IV from your memory.json
    //     const testEncryptedDataHex = "f55bfc42aac6dcdad0629bb5d8593a7e"; // Use encryptedData from memory.json
    //     const testKey = deriveKey(encryptionKey);
    //     const testIv = Buffer.from(testIvHex, 'hex');
    //     const testEncryptedBuffer = Buffer.from(testEncryptedDataHex, 'hex');

    //     try {
    //         const decipherTest = crypto.createDecipheriv('aes-256-cbc', testKey, testIv);
    //         let decryptedTest = decipherTest.update(testEncryptedBuffer);
    //         decryptedTest = Buffer.concat([decryptedTest, decipherTest.final()]);
    //         const decryptedTestString = decryptedTest.toString('utf8');
    //         logger.debug('ISOLATED DECRYPTION TEST - SUCCESS:', { decryptedString: decryptedTestString });
    //         try {
    //             const decryptedTestJson = JSON.parse(decryptedTestString);
    //             logger.debug('ISOLATED DECRYPTION TEST - JSON PARSE SUCCESS:', { parsedKeys: Object.keys(decryptedTestJson) });
    //         } catch (jsonError) {
    //             logger.error('ISOLATED DECRYPTION TEST - JSON PARSE ERROR:', { error: jsonError.message, decryptedString: decryptedTestString });
    //         }

    //     } catch (decryptError) {
    //         logger.error('ISOLATED DECRYPTION TEST - DECRYPTION ERROR:', { error: decryptError.message });
    //     }
    //     logger.debug('--- ISOLATED DECRYPTION TEST COMPLETE ---');
    // }
    // END OF ISOLATED DECRYPTION TEST

    try {
        if (!fs.existsSync(memoryFile)) {
            logger.warn(`Memory file not found, initializing empty memory`, { path: memoryFile });
            return { messages: [] };
        }
        logger.debug('Memory file exists.', { filePath: memoryFile });

        const fileContent = fs.readFileSync(memoryFile, 'utf-8');
        logger.debug('Raw file content read:', { filePath: memoryFile, contentPreview: fileContent.substring(0, 50) + '...' });
        if (!fileContent) {
            logger.warn('Memory file is empty, returning empty memory', { path: memoryFile });
            return { messages: [] };
        }

        try {
            // First try parsing as unencrypted JSON
            const data = JSON.parse(fileContent);
            logger.debug('JSON parsing successful (unencrypted).', { filePath: memoryFile, parsedDataPreview: data ? Object.keys(data).join(',') : 'null' });
            if (data.messages) {
                logger.debug('Memory data contains messages array.', { messageCount: data.messages.length });
                return data;
            } else {
                logger.debug('Parsed JSON does not have messages property.', { parsedKeys: Object.keys(data) });
            }

            // If it has IV and encryptedData, it's encrypted
            if (data.iv && data.encryptedData) {
                if (!encryptionKey) {
                    logger.warn('Encrypted memory file but no encryption key provided!');
                    return { messages: [] };
                }
                logger.debug('Memory data appears to be encrypted.', { hasIV: !!data.iv, hasEncryptedData: !!data.encryptedData });
                const key = deriveKey(encryptionKey);
                const iv = Buffer.from(data.iv, 'hex');
                const encryptedText = Buffer.from(data.encryptedData, 'hex');
                
                logger.debug('Starting decryption process...', { ivHex: data.iv, encryptedDataHex: data.encryptedData, keyHex: key.toString('hex').substring(0, 20) + '...' });

                try {
                    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
                    let decrypted = decipher.update(encryptedText);
                    decrypted = Buffer.concat([decrypted, decipher.final()]);

                    const decryptedString = decrypted.toString();
                    logger.debug('Decrypted memory content:', { contentPreview: decryptedString.substring(0, 50) + '...' });

                    const decryptedData = JSON.parse(decryptedString);
                    logger.debug('Decrypted and parsed successfully.', { filePath: memoryFile, decryptedDataPreview: decryptedData ? Object.keys(decryptedData).join(',') : 'null' });
                    console.log('Decrypted Data (Success) - Keys:', Object.keys(decryptedData));
                    console.log('Decrypted Data (Success):', decryptedData);

                    logger.debug('Decrypted Data Structure:', decryptedData);

                    return decryptedData.messages || [];
                } catch (decryptError) {
                    logger.error('Decryption error:', decryptError);
                    logger.warn('Memory file in unknown format, returning empty - decryption error');
                    console.error('Decryption Error Details:', decryptError);
                    return { messages: [] };
                }
            } else {
                logger.warn('Memory file in unknown format, returning empty - no IV/encryptedData or no encryptionKey');
                logger.debug('Data keys:', Object.keys(data));
                logger.debug('Encryption key provided:', !!encryptionKey);
                return { messages: [] };
            }

            // If we get here, the data is in an unknown format
            logger.warn('Memory file in unknown format, returning empty - fallback');
            return { messages: [] };
        } catch (parseError) {
            console.error('Decrypted Data (Parse Error):', parseError);
            logger.error('Error parsing memory as JSON (unencrypted)', { path: memoryFile, error: parseError.message });
            logger.warn('Memory file in unknown format, returning empty - JSON parse error');
            return { messages: [] };
        }
    } catch (err) {
        logger.error('Memory file read error:', err);
        logger.warn('Memory file in unknown format, returning empty - file read error');
        return { messages: [] };
    }
}

export function saveMemory(memoryData, encryptionKey) {
    logger.debug('Starting saveMemory...', { encryptionEnabled: !!encryptionKey });
    try {
        if (!fs.existsSync('memories')) {
            fs.mkdirSync('memories');
        }
        
        let memories = { messages: [] };
        try {
            memories = loadMemory('memories/memory.json', encryptionKey) || { messages: [] };
        } catch (loadError) {
            logger.error('Load error in saveMemory:', loadError);
        }
        
        if (!memories || typeof memories !== 'object') {
            logger.warn('loadMemory returned invalid memories data, resetting to default');
            memories = { messages: [] };
        }
        if (!memories.messages) memories.messages = [];
        memories.messages.push(memoryData);
        
        logger.debug('Data to be saved - memoryData:', memoryData);
        logger.debug('Data to be saved - memories object before save:', memories);
        
        let fileContentToWrite;
        if (!encryptionKey) {
            // Save without encryption if no key provided
            fileContentToWrite = JSON.stringify(memories, null, 2);
            logger.debug('Saving unencrypted memory content:', { contentPreview: fileContentToWrite.substring(0, 50) + '...' }); // Log unencrypted content
        } else {
            // Save with encryption
            const key = deriveKey(encryptionKey);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            
            let encrypted = cipher.update(JSON.stringify(memories));
            encrypted = Buffer.concat([encrypted, cipher.final()]);
            
            const encryptedDataBase64 = { // Create object for logging
                iv: iv.toString('hex'),
                encryptedData: encrypted.toString('hex')
            };
            logger.debug('Saving encrypted memory data:', encryptedDataBase64); // Log encrypted data object

            fileContentToWrite = JSON.stringify(encryptedDataBase64, null, 2);

            logger.debug('Length of encryptedData before write:', encryptedDataBase64.encryptedData.length); // ADDED: Log encryptedData length
        }

        try {
            fs.writeFileSync('memories/memory.json', fileContentToWrite);
            logger.debug('Memory saved successfully to file.');
        } catch (writeError) {
            logger.error('Error writing memory file:', writeError);
            logger.error('File write error details:', writeError); // ADDED: More detailed error log
            console.error('writeFileSync Error:', writeError); // ADDED: Console error output for write errors
            throw writeError;
        }

        logger.debug('Memory save process completed');
    } catch (err) {
        logger.error('Save memory error:', err);
        throw err;
    }
}

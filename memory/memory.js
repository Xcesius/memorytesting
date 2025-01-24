const fs = require('fs');
const crypto = require('crypto');
const path = require('path')
const { EncryptionManager } = require('./encryption.js');

const encryptor = new EncryptionManager(process.env.MASTER_KEY);

function deriveKey(key) {
    return crypto.createHash('sha256').update(String(key)).digest();
}

function loadMemory(memoryFile, encryptionKey) {
    try {
        console.log('[DEBUG] Trying to load memory from:', memoryFile);
        
        if (!fs.existsSync(memoryFile)) {
            console.log('[DEBUG] Memory file does not exist');
            return { messages: [] };
        }
        
        try {
            const data = JSON.parse(fs.readFileSync(memoryFile));
            const iv = Buffer.from(data.iv, 'hex');
            const encryptedText = Buffer.from(data.encryptedData, 'hex');
            
            const key = deriveKey(encryptionKey);
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            
            const parsed = JSON.parse(decrypted.toString());
            return parsed && parsed.messages ? parsed : { messages: [] };
        } catch (decryptError) {
            console.error('Decryption error:', decryptError);
            return { messages: [] };
        }
    } catch (err) {
        console.error('Memory error:', err);
        return { messages: [] };
    }
}

function saveMemory(memoryData, encryptionKey) {
    try {
        if (!fs.existsSync('memories')) {
            fs.mkdirSync('memories');
        }
        
        let memories = { messages: [] };
        try {
            memories = loadMemory('memories/memory.json', encryptionKey) || { messages: [] };
        } catch (loadError) {
            console.error('Load error in saveMemory:', loadError);
        }
        
        if (!memories.messages) memories.messages = [];
        memories.messages.push(memoryData);
        
        const key = deriveKey(encryptionKey);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        
        let encrypted = cipher.update(JSON.stringify(memories));
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        
        fs.writeFileSync('memories/memory.json', JSON.stringify({
            iv: iv.toString('hex'),
            encryptedData: encrypted.toString('hex')
        }));
        
        console.log('Memory saved successfully');
    } catch (err) {
        console.error('Save memory error:', err);
        throw err;
    }
}

module.exports = {
    saveMemory,
    loadMemory
};
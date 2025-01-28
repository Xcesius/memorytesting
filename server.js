import 'dotenv/config';
import { logger } from './utils/logger.js';
import { MemoryCleanup } from './memory/memory-cleanup.js';
import { ErrorRecovery } from './utils/error-recovery.js';
import { ConversationContext } from './memory/conversation-context.js';
import { MemoryPriority } from './memory/memory-priority.js';
import { MemoryCache } from './memory/memory-cache.js';
import fs from 'fs';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { chatCompletion } from './chat-completion.js';
import { saveMemory, loadMemory } from './memory/memory.js';
import { VectorDB } from './memory/vector-db.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// AI Configuration
const AI_BACKEND_URL = 'http://127.0.0.1:1234';
const AI_MODEL = 'deepseek-r1-distill-qwen-14b';

// Check environment variables
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    logger.warn('ENCRYPTION_KEY not provided - running without encryption');
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Create necessary directories
if (!fs.existsSync('memories')) {
    fs.mkdirSync('memories');
}
if (!fs.existsSync('backups')) {
    fs.mkdirSync('backups');
}

// Initialize empty memory file if it doesn't exist
if (!fs.existsSync('memories/memory.json')) {
    fs.writeFileSync('memories/memory.json', JSON.stringify({ messages: [] }, null, 2));
}

// Rate limiting middleware
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: { error: 'Too many requests, please try again later.' }
});

// Input validation middleware
const validateInput = (req, res, next) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
    }
    if (prompt.length < 1 || prompt.length > 2000) {
        return res.status(400).json({ error: 'Message length must be between 1 and 2000 characters' });
    }
    next();
};

const memoryCleanup = new MemoryCleanup();
const errorRecovery = new ErrorRecovery();
const conversationContext = new ConversationContext();
const memoryPriority = new MemoryPriority();
const memoryCache = new MemoryCache();

async function initializeAI() {
    const vectorDB = new VectorDB();
    try {
        await vectorDB.loadIndex();
        vectorDB.startMaintenance();
        memoryCleanup.start();

        // Prewarm cache with recent memories
        logger.debug('Checking ENCRYPTION_KEY value:', { ENCRYPTION_KEY });
        let memories = loadMemory('memories/memory.json', ENCRYPTION_KEY) || { messages: [] };
        if (memories && memories.messages) {
            const prioritized = memoryPriority.sortMemoriesByPriority(memories.messages);
            const topMemories = prioritized.slice(0, 100); // Cache top 100 memories
            memoryCache.setMany(
                Object.fromEntries(topMemories.map(m => [m.id, m]))
            );
        }

        logger.info('System initialized successfully', {
            cacheStats: memoryCache.getStats()
        });
    } catch (error) {
        logger.error('System initialization failed', { error: error.message });
        process.exit(1);
    }
}

// Apply rate limiting to all routes
app.use('/api/', limiter);

app.post('/api/chat', validateInput, async (req, res) => {
    const { prompt, conversationId = conversationContext.generateConversationId() } = req.body;
    
    try {
        logger.info('Processing chat request', { 
            prompt_length: prompt.length, 
            conversationId,
            prompt_preview: prompt.substring(0, 100)
        });

        const context = conversationContext.getContext(conversationId);

        logger.debug('Retrieved conversation context', { contextLength: context.length, conversationId });

        // Log context BEFORE reformatting, especially for new conversations
        if (!conversationId) {
            logger.debug('Context BEFORE reformatting (new conversation):', { context });
        }

        // Reformat context items
        const reformattedContext = context.map(item => ({
            role: 'assistant', // Assuming previous turns are assistant responses
            content: item.response
        }));

        // Add user message to context
        const contextWithUserMessage = [...reformattedContext, { role: 'user', content: prompt }];

        // Log context AFTER reformatting, especially for new conversations
        if (!conversationId) {
            logger.debug('Context AFTER reformatting (new conversation):', { context: contextWithUserMessage });
        }

        const completionResult = await errorRecovery.withRecovery(
            async () => chatCompletion(prompt, contextWithUserMessage), // Use reformatted context
            { type: 'chat_completion', conversationId }
        );

        if (!completionResult || !completionResult.response) {
            logger.error('Chat completion returned invalid result');
            return res.status(500).json({ error: 'Invalid response from AI service' });
        }

        // Send thinking message separately if available
        if (completionResult.thinking) {
            sendThinkingMessage(completionResult.thinking);
        }

        // Construct response JSON
        const responseJson = {
            response: completionResult.response,
            conversationId: conversationId,
            tokens: completionResult.thinking, // Still send token count as 'thinking' for now
        };

        // Add to conversation context
        conversationContext.addToContext(conversationId, prompt, completionResult.response);

        // Enhance memory data with conversation info
        const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const enhancedMemoryData = {
            ...completionResult.memoryData,
            id: memoryId,
            conversationId,
            personalityTraits: completionResult.personalityTraits,
            contextSize: context?.length || 0
        };

        try {
            await errorRecovery.withRecovery(
                async () => {
                    // Update memory priority
                    const priority = memoryPriority.updatePriority(memoryId, enhancedMemoryData, 'write');
                    
                    // Cache the new memory
                    memoryCache.set(memoryId, {
                        ...enhancedMemoryData,
                        priority
                    });
                    
                    // Save to persistent storage
                    return saveMemory(enhancedMemoryData, ENCRYPTION_KEY);
                },
                { type: 'memory_save', filePath: 'memories/memory.json' }
            );
            logger.debug('Memory saved successfully');
        } catch (saveError) {
            logger.error('Memory save failed', { error: saveError.message });
        }

        res.json(responseJson);
    } catch (error) {
        logger.error('API Error', { error: error.message, stack: error.stack });
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Add context management endpoints
app.get('/api/context/:conversationId', (req, res) => {
    const { conversationId } = req.params;
    const summary = conversationContext.summarizeContext(conversationId);
    if (!summary) {
        return res.status(404).json({ error: 'Context not found' });
    }
    res.json(summary);
});

app.post('/api/context/merge', (req, res) => {
    const { sourceId, targetId } = req.body;
    if (!sourceId || !targetId) {
        return res.status(400).json({ error: 'Source and target IDs required' });
    }
    
    const success = conversationContext.mergeContexts(sourceId, targetId);
    if (!success) {
        return res.status(400).json({ error: 'Failed to merge contexts' });
    }
    
    res.json({ message: 'Contexts merged successfully' });
});

app.get('/api/debug/write-test', (req, res) => {
    try {
        fs.writeFileSync('memories/test.txt', 'test content');
        res.send('Write successful');
    } catch (err) {
        res.status(500).send(`Write failed: ${err.message}`);
    }
});

app.get('/api/memory', (req, res) => {
    try {
        const memories = loadMemory('memories/memory.json', ENCRYPTION_KEY);
        res.json(memories);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load memories' });
    }
});

// Add memory management endpoints
app.get('/api/memory/stats', (req, res) => {
    res.json({
        cache: memoryCache.getStats(),
        conversations: {
            active: conversationContext.conversations.size
        }
    });
});

app.post('/api/memory/optimize', async (req, res) => {
    try {
        const memories = loadMemory('memories/memory.json', ENCRYPTION_KEY);
        if (memories && memories.messages) {
            // Prioritize and prune memories
            const optimizedMemories = memoryPriority.pruneByPriority(
                memories.messages,
                1024 * 1024 * 100 // 100MB max size
            );

            // Update cache with optimized memories
            memoryCache.clear();
            memoryCache.setMany(optimizedMemories);

            // Save optimized memories
            await saveMemory({ messages: optimizedMemories });
            
            res.json({ 
                message: 'Memory optimization complete',
                stats: {
                    originalSize: Object.keys(memories.messages).length,
                    optimizedSize: Object.keys(optimizedMemories).length,
                    cache: memoryCache.getStats()
                }
            });
        } else {
            res.status(400).json({ error: 'No memories to optimize' });
        }
    } catch (error) {
        logger.error('Memory optimization failed', { error: error.message });
        res.status(500).json({ error: 'Memory optimization failed' });
    }
});

// Add test endpoint
app.get('/api/test', (req, res) => {
    res.json({ status: 'ok', message: 'Server is responding' });
});

// Serve root route
app.get('/', function(req, res) {
    res.sendFile(__dirname + '/public/index.html');
});

process.on('SIGINT', () => {
    logger.info('Shutting down server');
    memoryCleanup.stop();
    process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    initializeAI();
});

function sendThinkingMessage(thinking) {
    logger.info('Thinking process:', { thinking }); // Log the thinking TEXT
}
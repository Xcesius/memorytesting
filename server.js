import dotenv from 'dotenv';
dotenv.config();

const fs = require('fs');
const express = require('express');
const app = express();
const { chatCompletion } = require('./chat-completion');
const { saveMemory, loadMemory } = require('./memory/memory.js');
const { VectorDB } = require('./memory/vector-db.js');

app.use(express.json());
app.use(express.static(__dirname + '/public'));

if (!fs.existsSync('memories')) {
    fs.mkdirSync('memories');
}

async function initializeAI() {
    const vectorDB = new VectorDB();
    try {
        await vectorDB.loadIndex();
        vectorDB.startMaintenance();
        console.log('VectorDB initialized successfully');
    } catch (error) {
        console.error('VectorDB initialization failed:', error);
        process.exit(1);
    }
}

app.post('/api/chat', async (req, res) => {
    const { prompt } = req.body;
    try {
        const completionResult = await chatCompletion(prompt); // Get the object with response and thinking
        const response = completionResult.response;
        const thinking = completionResult.thinking; // Extract thinking

        const memoryData = {
            text: prompt,
            response: response,
            timestamp: new Date().toISOString()
        };

        try {
            saveMemory(memoryData);
        } catch (saveError) {
            console.error('Memory save failed:', saveError);
        }

        res.json({ response: response, thinking: thinking }); // Send both response and thinking
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
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

// Serve root route
app.get('/', function(req, res) {
    res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
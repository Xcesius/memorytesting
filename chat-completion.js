import { logger } from './utils/logger.js';
import fetch from 'node-fetch';
import { MemoryPriority } from './memory/memory-priority.js';
import { PersonalityEngine } from './memory/personality-engine.js';
import { MemoryCache } from './memory/memory-cache.js';
import { loadMemory } from './memory/memory.js';

const AI_BACKEND_URL = 'http://127.0.0.1:1234';
const AI_MODEL = 'deepseek-r1-distill-qwen-14b';
const TIMEOUT_MS = 60000; // 10 second timeout

const memoryPriority = new MemoryPriority();
const personalityEngine = new PersonalityEngine();
const memoryCache = new MemoryCache();

function splitCompoundQuestions(prompt) {
    // Split on "and" or "," followed by question words
    const parts = prompt.split(/(?:,|\band\b)\s*(?=(?:what|who|where|when|why|how)\b)/i);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

export async function chatCompletion(prompt, context = []) {
    // Input validation for prompt and context
    if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > 4000) { // Example max prompt length
        logger.warn('Invalid prompt input', { promptLength: prompt?.length, promptType: typeof prompt });
        throw new Error('Invalid prompt: Prompt must be a non-empty string and under 4000 characters.');
    }

    if (!Array.isArray(context)) {
        logger.warn('Invalid context input', { contextType: typeof context });
        throw new Error('Invalid context: Context must be an array.');
    }

    for (const contextItem of context) {
        if (typeof contextItem !== 'object' || !contextItem.content) {
            logger.warn('Invalid context item', { contextItem });
            throw new Error('Invalid context: Each context item must be an object with a content property.');
        }
        if (typeof contextItem.content !== 'string' || contextItem.content.length > 2000) { // Example max context item length
            logger.warn('Invalid context content', { content: contextItem.content?.length, contentType: typeof contextItem.content });
            throw new Error('Invalid context: Context content must be a string under 2000 characters.');
        }
    }

    try {
        logger.debug('Preparing chat completion request', { 
            backend: AI_BACKEND_URL,
            model: AI_MODEL,
            promptLength: prompt.length,
            contextLength: context.length
        });
        sendThinkingMessage('Preparing chat completion request...\n'); // Send to client

        // Check for compound questions
        const questions = splitCompoundQuestions(prompt);
        if (questions.length > 1) {
            logger.debug('Detected compound question', { questions });
            
            // Process each question separately and combine responses
            const responses = await Promise.all(questions.map(async (q) => {
                const result = await processSingleQuestion(q, context);
                return result.response;
            }));
            
            const combinedResponse = responses.join('\n');

            // Split thinking and response parts
            const thinkingMatch = combinedResponse.match(/<think>(.*?)<\/think>/s);
            const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
            const responseText = combinedResponse.replace(/<think>.*?<\/think>/s, '').trim();

            return {
                response: responseText, // Send only the actual response part
                thinking: thinking, // Send the extracted thinking part separately
                memoryData: {
                    text: prompt,
                    response: combinedResponse, // Keep the full response with thinking for memory
                    timestamp: new Date().toISOString()
                },
                personalityTraits: personalityEngine.getBaseTraits()
            };
        }
        
        return processSingleQuestion(prompt, context);
    } catch (error) {
        logger.error('Chat completion failed', { 
            error: error.message,
            stack: error.stack,
            prompt_length: prompt.length,
            context_length: context.length
        });
        sendThinkingMessage(`Chat completion failed: ${error.message}\n`); // Send error to client
        throw error;
    }
}

async function processSingleQuestion(prompt, context) {
    // Get relevant memories from cache and memory file
    const memories = memoryCache.getAll();
    const fileMemories = loadMemory('memories/memory.json')?.messages || [];
    const allMemories = [...Object.values(memories), ...fileMemories];

    // Sort memories by priority and get top 5 most relevant
    const relevantMemories = await memoryPriority.findRelevantMemories(prompt, context);

    logger.debug('Found relevant memories', { 
        count: relevantMemories.length,
        priorities: relevantMemories.map(m => memoryPriority.getPriority(m.id, m))
    });

    sendThinkingMessage('Retrieving relevant memories...\n'); // Send to client

    // Adjust personality based on context and memories
    const personalityTraits = personalityEngine.analyzeContext([...context, ...relevantMemories]);
    const personalityPrompt = personalityEngine.generatePersonalityPrompt(personalityTraits);
    
    logger.debug('Personality analysis', { 
        traits: personalityTraits,
        prompt: personalityPrompt
    });

    sendThinkingMessage('Analyzing personality...\n'); // Send to client

    // Construct messages array with system prompt, memories, and context
    const reformattedContext = context.map(c => ({
        role: c.role || (c.isUser ? 'user' : 'assistant'),
        content: c.content || c.text
    })).filter(c => c.content);

    const messages = [
        {
            role: 'system',
            content: `${personalityPrompt}\nYou are Jarvis, an advanced AI assistant. Always identify as Jarvis.\nYou have access to these relevant memories: ${
                relevantMemories.map(m => `[Memory: ${m.text} -> ${m.response}]`).join('\n')
            }`
        },
        ...reformattedContext,
        { role: 'user', content: prompt }
    ];

    sendThinkingMessage('Constructing AI request...\n'); // Send to client

    const requestBody = {
        model: AI_MODEL,
        messages: messages,
        temperature: personalityTraits.creativity || 0.7,
        max_tokens: 2000,
        stream: false
    };

    logger.debug('Sending request to AI backend', { 
        url: `${AI_BACKEND_URL}/v1/chat/completions`,
        requestBody: JSON.stringify(requestBody)
    });

    sendThinkingMessage('Sending request to AI backend...\n'); // Send to client

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, TIMEOUT_MS);

    try {
        const response = await fetch(`${AI_BACKEND_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('API request failed', {
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                headers: response.headers.raw()
            });
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const responseData = await response.json();
        
        // Calculate priority for the new memory
        const memoryData = {
            text: prompt,
            response: responseData.choices[0].message.content,
            timestamp: new Date().toISOString()
        };

        const priority = memoryPriority.calculateBasePriority(memoryData);
        memoryData.priority = priority;

        // Update memory cache
        memoryCache.set(memoryData.timestamp, memoryData);

        logger.debug('AI Response received', { 
            status: response.status,
            model: AI_MODEL,
            responseLength: responseData.choices[0].message.content.length,
            tokens: responseData.usage.total_tokens,
            memoryPriority: priority
        });

        // Extract thinking process (assuming it's before the first </think> tag)
        const fullResponse = responseData.choices[0].message.content;
        const thinkingEndTag = fullResponse.indexOf('</think>');
        let thinkingText = '';
        let responseText = fullResponse;

        if (thinkingEndTag !== -1) {
            thinkingText = fullResponse.substring(0, thinkingEndTag);
            responseText = fullResponse.substring(thinkingEndTag + 8).trim(); // +8 to remove </think> tag itself
            sendThinkingMessage(thinkingText); // Send the extracted thinking TEXT
        } else {
            sendThinkingMessage("No explicit thinking process in response."); // Or handle no thinking process
        }

        sendThinkingMessage('AI response received and processed.\n'); // Send to client

        return {
            response: responseText,
            thinking: thinkingText,
            memoryData: memoryData,
            personalityTraits: personalityTraits
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            sendThinkingMessage(`Request timed out after ${TIMEOUT_MS}ms\n`); // Send timeout to client
            throw new Error(`Request timed out after ${TIMEOUT_MS}ms`);
        }
        sendThinkingMessage(`Error during AI request: ${error.message}\n`); // Send fetch error to client
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

// Mock sendThinkingMessage for now - you'll need to implement WebSocket or SSE for real-time updates
function sendThinkingMessage(message) {
    console.log('[Thinking]:', message); // For now, just log to console
    // In a real app, you'd send this message to the client over WebSocket or SSE
} 
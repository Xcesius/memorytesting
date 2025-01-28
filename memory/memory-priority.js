import { loadMemory } from './memory.js';
import { logger } from '../utils/logger.js';

const PRIORITY_LEVELS = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
};

const PRIORITY_DECAY_RATE = 0.1; // Priority decay per day
const INTERACTION_BOOST = 0.5; // Priority boost when memory is accessed
const EMOTION_BOOST = 0.3; // Priority boost for emotional content
const CONTEXT_BOOST = 0.4; // Priority boost for contextual relevance

const PRIORITY_PATTERNS = {
    CRITICAL: [
        // Security and sensitive information
        /password|key|secret|important|critical/i,
        /remember|don't forget|urgent/i,
        /private|confidential|sensitive/i,

        // Personal information
        /phone|address|email|contact/i,
        /birthday|anniversary|date/i,
        /account|login|credentials/i,

        // Task-related
        /deadline|due|schedule|appointment/i,
        /project|task|todo|reminder/i,
        /meeting|call|conference/i
    ],

    HIGH: [
        // Questions and inquiries (must start with question word)
        /^(what|who|where|when|why|how)\s/i,
        /^(can you )?explain|describe|tell me|show me/i,
        /^(can you )?help|assist|guide|support/i,

        // Commands and requests (must be at start)
        /^(please|could you|would you|can you)\s/i,
        /^(need to|must|should|have to)\s/i,
        /^(create|update|change|modify)\s/i,

        // Learning and preferences (must be explicit)
        /\b(prefer|like|dislike|favorite)\b.{0,20}\bis\b/i,
        /\b(learn|understand|know|remember)\b.{0,20}(about|how|why|what)/i,
        /\b(always|never)\b.{0,20}(do|use|have|should)/i
    ],

    MEDIUM: [
        // General conversation
        /\b(think|feel|believe)\b.{0,20}\babout\b/i,
        /\b(interesting|curious|wonder)\b.{0,20}\b(about|if|how|why|what)\b/i,
        /\b(maybe|perhaps|possibly)\b.{0,20}\b(should|could|would)\b/i,

        // Status and updates
        /\b(status|progress)\b.{0,20}\bof\b/i,
        /\b(working on|doing|making)\b.{0,20}\b(the|this|that|my)\b/i,
        /\b(finished|completed|done)\b.{0,20}\b(with|the|this|that)\b/i
    ],

    LOW: [
        // Casual chat
        /^(hi|hello|hey|bye)(\s|$)/i,
        /^(thanks|thank you|ok|okay)(\s|$)/i,
        /^(cool|nice|great|awesome)(\s|$)/i,
        /^how are you/i  // Explicitly match greeting
    ]
};

const EMOTION_PATTERNS = [
    /happy|sad|angry|excited|worried|anxious|love|hate/i,
    /😊|😢|😠|😃|😨|😰|❤️|💔/,
    /\!{2,}|\?{2,}/
];

export class MemoryPriority {
    constructor(maxCachedMemories = 1000) {
        this.priorities = new Map();
        this.lastAccess = new Map();
        this.contextScores = new Map();
        this.cache = new Map();
        this.maxCachedMemories = maxCachedMemories;
    }

    async loadMemories() {
        try {
            // Load from memory file
            const fileMemories = loadMemory('memories/memory.json')?.messages || [];
            
            // Load from cache
            const cacheMemories = Array.from(this.cache.values());
            
            // Combine and deduplicate by id
            const allMemories = [...fileMemories, ...cacheMemories];
            const uniqueMemories = allMemories.filter((memory, index, self) =>
                index === self.findIndex((m) => m.id === memory.id)
            );
            
            // Enforce max cache size after loading
            if (uniqueMemories.length > this.maxCachedMemories) {
                logger.warn('Loaded memories exceed max cache size, pruning...', { loaded: uniqueMemories.length, maxCache: this.maxCachedMemories });
                uniqueMemories.length = this.maxCachedMemories; // Truncate to max size
            }

            return uniqueMemories;
        } catch (error) {
            logger.error('Failed to load memories:', error);
            return [];
        }
    }

    calculateBasePriority(memory) {
        let priority = PRIORITY_LEVELS.LOW;
        const content = `${memory.text} ${memory.response}`;

        // Check for exact greetings first
        const greetingPattern = /^(hi|hello|hey|bye|thanks|thank you|ok|okay|cool|nice|great|awesome)(\s|$)|^how are you/i;
        if (greetingPattern.test(content)) {
            logger.debug('Found greeting pattern - setting LOW priority');
            return PRIORITY_LEVELS.LOW;
        }

        // Check for identity-related content
        if (/\b(your name|my name)\b/i.test(content)) {
            logger.debug('Found identity-related content - setting HIGH priority');
            return PRIORITY_LEVELS.HIGH;
        }

        // Then check patterns in order of priority
        if (PRIORITY_PATTERNS.CRITICAL.some(pattern => pattern.test(content))) {
            logger.debug('Found CRITICAL pattern');
            priority = PRIORITY_LEVELS.CRITICAL;
        } else if (PRIORITY_PATTERNS.HIGH.some(pattern => pattern.test(content))) {
            logger.debug('Found HIGH pattern');
            priority = PRIORITY_LEVELS.HIGH;
        } else if (PRIORITY_PATTERNS.MEDIUM.some(pattern => pattern.test(content))) {
            logger.debug('Found MEDIUM pattern');
            priority = PRIORITY_LEVELS.MEDIUM;
        }

        // Add boosts after setting base priority
        let boost = 0;

        // Check emotional content
        if (EMOTION_PATTERNS.some(pattern => pattern.test(content))) {
            boost += EMOTION_BOOST;
        }

        // Check message length and complexity
        const wordCount = content.split(/\s+/).length;
        if (wordCount > 50) boost += 0.2;
        if (wordCount > 100) boost += 0.3;

        // Check for code blocks or technical content (higher boost)
        if (content.includes('```') || /function|class|const|let|var/.test(content)) {
            boost += 1.5; // Increased from 0.4 to ensure it's higher than base levels
            priority = Math.max(priority, PRIORITY_LEVELS.MEDIUM); // Set minimum priority for code
        }

        // Check for URLs or references
        if (/https?:\/\/[^\s]+/.test(content)) {
            boost += 0.3;
        }

        const finalPriority = priority + boost;

        logger.debug('Priority calculated', {
            content: content.substring(0, 50) + '...',
            basePriority: priority,
            boost,
            finalPriority,
            baseLevel: Object.entries(PRIORITY_LEVELS)
                .find(([_, value]) => value <= priority)?.[0] || 'CUSTOM',
            patterns: {
                hasEmotion: EMOTION_PATTERNS.some(pattern => pattern.test(content)),
                wordCount,
                hasCode: content.includes('```'),
                hasUrl: /https?:\/\/[^\s]+/.test(content)
            }
        });

        return finalPriority;
    }

    calculateDecay(timestamp) {
        const daysSinceCreation = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
        return Math.max(0, PRIORITY_DECAY_RATE * daysSinceCreation);
    }

    updateContextScore(memoryId, relatedMemories) {
        let contextScore = 0;
        const memory = relatedMemories.find(m => m.id === memoryId);
        if (!memory) return;

        // Calculate similarity with other memories
        for (const other of relatedMemories) {
            if (other.id === memoryId) continue;
            
            // Time proximity
            const timeDiff = Math.abs(new Date(memory.timestamp) - new Date(other.timestamp));
            const timeScore = Math.exp(-timeDiff / (24 * 60 * 60 * 1000)); // Decay over 24 hours
            
            // Conversation continuity
            const conversationScore = memory.conversationId === other.conversationId ? 1 : 0;
            
            // Content similarity (simple word overlap)
            const memoryWords = new Set(memory.text.toLowerCase().split(/\s+/));
            const otherWords = new Set(other.text.toLowerCase().split(/\s+/));
            const intersection = new Set([...memoryWords].filter(x => otherWords.has(x)));
            const similarityScore = intersection.size / Math.max(memoryWords.size, otherWords.size);
            
            contextScore += (timeScore + conversationScore + similarityScore) / 3;
        }

        this.contextScores.set(memoryId, contextScore * CONTEXT_BOOST);
    }

    getPriority(memoryId, memory) {
        if (!this.priorities.has(memoryId)) {
            const basePriority = this.calculateBasePriority(memory);
            this.priorities.set(memoryId, basePriority);
        }

        let priority = this.priorities.get(memoryId);
        const decay = this.calculateDecay(memory.timestamp);
        const contextScore = this.contextScores.get(memoryId) || 0;
        
        // Apply access boost if recently accessed
        const lastAccess = this.lastAccess.get(memoryId);
        if (lastAccess) {
            const hoursSinceAccess = (Date.now() - lastAccess) / (1000 * 60 * 60);
            if (hoursSinceAccess < 24) {
                priority += INTERACTION_BOOST * (1 - hoursSinceAccess / 24);
            }
        }

        return Math.max(0, priority + contextScore - decay);
    }

    updatePriority(memoryId, memory, accessType = 'read') {
        const currentPriority = this.getPriority(memoryId, memory);
        this.lastAccess.set(memoryId, Date.now());

        // Boost priority on write/modify operations
        if (accessType === 'write' || accessType === 'modify') {
            this.priorities.set(memoryId, currentPriority + INTERACTION_BOOST);
        }

        logger.debug('Memory priority updated', { 
            memoryId, 
            priority: this.priorities.get(memoryId),
            accessType 
        });
    }

    sortMemoriesByPriority(memories) {
        return Object.entries(memories)
            .map(([id, memory]) => ({
                id,
                memory,
                priority: this.getPriority(id, memory)
            }))
            .sort((a, b) => b.priority - a.priority)
            .map(({ id, memory }) => ({ id, ...memory }));
    }

    pruneByPriority(memories, maxSize) {
        const prioritizedMemories = this.sortMemoriesByPriority(memories);
        const prunedMemories = {};
        let currentSize = 0;

        for (const memory of prioritizedMemories) {
            const memorySize = JSON.stringify(memory).length;
            if (currentSize + memorySize <= maxSize) {
                prunedMemories[memory.id] = memory;
                currentSize += memorySize;
            } else {
                logger.info('Memory pruned due to size limit', { 
                    memoryId: memory.id,
                    priority: this.getPriority(memory.id, memory)
                });
            }
        }

        return prunedMemories;
    }

    async findRelevantMemories(prompt, context) {
        const memories = await this.loadMemories();
        if (!memories || !memories.length) {
            return [];
        }

        // Convert prompt and context to searchable text
        const searchText = [
            prompt,
            ...context.map(c => c.text || c.content)
        ].join(' ').toLowerCase();

        // Extract key terms from search text
        const keyTerms = this._extractKeyTerms(searchText);

        // Score each memory for relevance
        const scoredMemories = memories.map(memory => {
            const memoryText = [
                memory.text,
                memory.response
            ].join(' ').toLowerCase();

            // Calculate semantic similarity using multiple methods
            const termSimilarity = this._calculateTermSimilarity(keyTerms, memoryText);
            const phraseSimilarity = this._calculatePhraseSimilarity(searchText, memoryText);
            const contextSimilarity = this._calculateContextSimilarity(context, memory);
            
            // Weight the different similarity scores
            const similarity = (
                termSimilarity * 0.4 + 
                phraseSimilarity * 0.4 + 
                contextSimilarity * 0.2
            );
            
            // Apply priority boost
            const priorityBoost = memory.priority ? memory.priority * 0.2 : 0;
            
            // Apply recency boost (memories from last hour get bonus)
            const recencyBoost = Date.now() - memory.timestamp < 3600000 ? 0.2 : 0;
            
            // Calculate final score
            const score = similarity + priorityBoost + recencyBoost;
            
            return { ...memory, score };
        });

        // Sort by score and return top 5 most relevant
        return scoredMemories
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .filter(m => m.score > 0.2); // Lowered threshold for more matches
    }

    _extractKeyTerms(text) {
        // Remove common words and extract key terms
        const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for']);
        return text.split(/\s+/)
            .map(word => word.toLowerCase())
            .filter(word => !stopWords.has(word) && word.length > 2);
    }

    _calculateTermSimilarity(keyTerms, text) {
        const textTerms = this._extractKeyTerms(text);
        const matches = keyTerms.filter(term => textTerms.includes(term));
        return matches.length / Math.max(keyTerms.length, textTerms.length);
    }

    _calculatePhraseSimilarity(text1, text2) {
        // Look for common phrases (2-3 words)
        const phrases1 = this._extractPhrases(text1);
        const phrases2 = this._extractPhrases(text2);
        
        const commonPhrases = phrases1.filter(p => phrases2.includes(p));
        return commonPhrases.length / Math.max(phrases1.length, phrases2.length);
    }

    _extractPhrases(text) {
        const words = text.split(/\s+/);
        const phrases = [];
        
        // Extract 2-3 word phrases
        for (let i = 0; i < words.length - 1; i++) {
            phrases.push(words[i] + ' ' + words[i + 1]);
            if (i < words.length - 2) {
                phrases.push(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
            }
        }
        
        return phrases;
    }

    _calculateContextSimilarity(context, memory) {
        if (!context.length || !memory.conversationId) return 0;

        let similarityScore = 0;

        // Boost for same conversation
        const sameConversation = context.some(c => c.conversationId === memory.conversationId);
        if (sameConversation) {
            similarityScore += 0.5; // Give a good boost for same conversation
        }

        // Temporal proximity - still useful, but less weight
        const contextTime = context[context.length - 1].timestamp;
        if (contextTime) {
            const timeDiff = Math.abs(new Date(contextTime) - new Date(memory.timestamp));
            const hoursDiff = timeDiff / (1000 * 60 * 60);
            similarityScore += Math.max(0, (12 - hoursDiff) / 12) * 0.3; // Reduce range and weight
            // Memories within 12 hours get a scaled similarity boost, decaying to 0 at 12 hours
        }

        // **[NEW] Keyword/Topic Overlap (very basic example - can be improved)**
        const contextText = context.map(c => c.content || c.text).join(" ");
        const memoryText = memory.text + " " + memory.response; // Include both text and response
        const contextKeywords = contextText.toLowerCase().split(/\s+/); // Simple split by spaces
        const memoryKeywords = memoryText.toLowerCase().split(/\s+/);

        let keywordOverlap = 0;
        for (const keyword of contextKeywords) {
            if (memoryKeywords.includes(keyword)) {
                keywordOverlap++;
            }
        }
        similarityScore += (keywordOverlap / Math.max(1, contextKeywords.length)) * 0.4; // Normalize and weight

        return similarityScore;
    }
} 
import { logger } from '../utils/logger.js';

const MAX_CONTEXT_LENGTH = 10; // Keep last 10 exchanges
const CONTEXT_EXPIRY = 30 * 60 * 1000; // 30 minutes

export class ConversationContext {
    constructor() {
        this.conversations = new Map();
        this.startCleanupInterval();
    }

    startCleanupInterval() {
        setInterval(() => this.cleanupExpiredContexts(), CONTEXT_EXPIRY);
    }

    generateConversationId() {
        return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    addToContext(conversationId, message, response) {
        if (!this.conversations.has(conversationId)) {
            this.conversations.set(conversationId, {
                exchanges: [],
                lastUpdated: Date.now()
            });
        }

        const context = this.conversations.get(conversationId);
        context.exchanges.push({
            message,
            response,
            timestamp: Date.now()
        });

        // Keep only the last MAX_CONTEXT_LENGTH exchanges
        if (context.exchanges.length > MAX_CONTEXT_LENGTH) {
            context.exchanges = context.exchanges.slice(-MAX_CONTEXT_LENGTH);
        }

        context.lastUpdated = Date.now();
        logger.debug('Context updated', { conversationId, contextSize: context.exchanges.length });
    }

    getContext(conversationId) {
        const context = this.conversations.get(conversationId);
        if (!context) {
            return [];
        }

        context.lastUpdated = Date.now();
        return context.exchanges;
    }

    cleanupExpiredContexts() {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, context] of this.conversations.entries()) {
            if (now - context.lastUpdated > CONTEXT_EXPIRY) {
                this.conversations.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.info('Cleaned expired contexts', { count: cleaned });
        }
    }

    summarizeContext(conversationId) {
        const context = this.getContext(conversationId);
        if (!context.length) return null;

        return {
            exchangeCount: context.length,
            firstTimestamp: context[0].timestamp,
            lastTimestamp: context[context.length - 1].timestamp,
            summary: context.map(ex => ({
                message: ex.message.substring(0, 100) + (ex.message.length > 100 ? '...' : ''),
                timestamp: ex.timestamp
            }))
        };
    }

    mergeContexts(sourceId, targetId) {
        const sourceContext = this.getContext(sourceId);
        const targetContext = this.getContext(targetId);

        if (!sourceContext.length || !targetContext.length) {
            logger.warn('Cannot merge contexts - one or both contexts missing', { sourceId, targetId });
            return false;
        }

        const mergedExchanges = [...targetContext, ...sourceContext]
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-MAX_CONTEXT_LENGTH);

        this.conversations.set(targetId, {
            exchanges: mergedExchanges,
            lastUpdated: Date.now()
        });

        this.conversations.delete(sourceId);
        logger.info('Contexts merged', { sourceId, targetId, exchangeCount: mergedExchanges.length });
        return true;
    }
} 
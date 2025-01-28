import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import crypto from 'crypto';

export class VectorDB {
    constructor() {
        this.index = new Map();
        this.wordVectors = new Map();
        this.vectorSize = 100;
    }

    async loadIndex() {
        try {
            // Load existing index if it exists
            try {
                const indexData = await fs.readFile('memories/vector_index.json', 'utf-8');
                const parsed = JSON.parse(indexData);
                this.index = new Map(Object.entries(parsed));
                logger.info('Vector index loaded', { entries: this.index.size });
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    logger.error('Error loading vector index', { error: err.message });
                }
            }
            return true;
        } catch (err) {
            logger.error('Failed to initialize vector DB', { error: err.message });
            throw err;
        }
    }

    startMaintenance() {
        setInterval(async () => {
            try {
                // Save index periodically
                const indexObj = Object.fromEntries(this.index);
                await fs.writeFile('memories/vector_index.json', JSON.stringify(indexObj));
                logger.info('Vector index saved', { entries: this.index.size });

                // Cleanup old vectors (older than 30 days)
                const now = Date.now();
                const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
                
                for (const [id, data] of this.index.entries()) {
                    if (data.lastAccessed < thirtyDaysAgo) {
                        this.index.delete(id);
                    }
                }
            } catch (err) {
                logger.error('Vector maintenance failed', { error: err.message });
            }
        }, 24 * 60 * 60 * 1000); // Run daily
    }

    getWordVector(word) {
        if (this.wordVectors.has(word)) {
            return this.wordVectors.get(word);
        }

        // Generate a deterministic vector for the word using its hash
        const hash = crypto.createHash('sha256').update(word).digest();
        const vector = new Array(this.vectorSize).fill(0);
        
        // Use the hash to generate vector values
        for (let i = 0; i < this.vectorSize; i++) {
            vector[i] = (hash[i % hash.length] - 128) / 128; // Normalize to [-1, 1]
        }

        this.wordVectors.set(word, vector);
        return vector;
    }

    async embed(text) {
        try {
            // Simple word vector averaging
            const words = text.toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter(word => word.length > 0);

            if (words.length === 0) {
                return new Array(this.vectorSize).fill(0);
            }

            const vectors = words.map(word => this.getWordVector(word));
            const sumVector = vectors.reduce((acc, vec) => {
                return acc.map((val, i) => val + vec[i]);
            }, new Array(this.vectorSize).fill(0));

            // Normalize the resulting vector
            const magnitude = Math.sqrt(sumVector.reduce((sum, val) => sum + val * val, 0));
            return sumVector.map(val => val / (magnitude || 1));
        } catch (err) {
            logger.error('Embedding generation failed', { error: err.message });
            throw err;
        }
    }

    async addMemory(text, metadata) {
        try {
            const embedding = await this.embed(text);
            this.index.set(metadata.id, {
                embedding,
                metadata,
                lastAccessed: Date.now()
            });
            return true;
        } catch (err) {
            logger.error('Failed to add memory to vector DB', { error: err.message });
            return false;
        }
    }

    async search(query, options = {}) {
        const { topK = 3, filter = () => true } = options;
        
        try {
            // Get query embedding
            const queryEmbedding = await this.embed(query);
            
            // Calculate cosine similarity with all vectors
            const results = Array.from(this.index.entries())
                .filter(([_, item]) => filter(item))
                .map(([id, item]) => ({
                    ...item,
                    similarityScore: this.cosineSimilarity(queryEmbedding, item.embedding)
                }));

            // Sort by similarity and return top K
            return results
                .sort((a, b) => b.similarityScore - a.similarityScore)
                .slice(0, topK);
        } catch (err) {
            logger.error('Vector search failed', { error: err.message });
            return [];
        }
    }

    cosineSimilarity(vecA, vecB) {
        // Calculate dot product
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        
        // Calculate magnitudes
        const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        
        // Return cosine similarity
        return dotProduct / (magA * magB);
    }
}
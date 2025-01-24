import { VectorDB } from './vector-db.js';
import { EncryptionManager } from './encryption.js';

export class MemoryCore {
  constructor(userId) {
    this.userId = userId;
    this.vectorDB = new VectorDB();
    this.encryptor = new EncryptionManager(process.env.MASTER_KEY);
    this.memoryBank = {
      shortTerm: [],
      longTerm: [],
      episodic: []
    };
    this.personalityMatrix = {
      helpfulness: 0.8,
      humor: 0.3,
      formality: 0.4,
      curiosity: 0.6
    };
  }

  async processInput(text) {
    // Generate embedding for current input
    const embedding = await this.vectorDB.embed(text);
    
    // Store in vector DB with metadata
    await this.vectorDB.addMemory(text, {
      userId: this.userId,
      type: 'conversation',
      originalText: text
    });
    
    // Retrieve relevant memories
    const relevantMemories = await this.vectorDB.search(embedding, {
      topK: 3,
      filter: memory => memory.lastAccessed > Date.now() - 86400000 // Last 24h
    });

    // Update memory weights
    this._updateMemoryWeights(relevantMemories);

    // Create context blend
    return this._createContextBlend(relevantMemories, text);
  }

  _updateMemoryWeights(memories) {
    memories.forEach(memory => {
      memory.weight = this._calculateMemoryWeight(memory);
      memory.lastAccessed = Date.now();
    });
  }

  _calculateMemoryWeight(memory) {
    const recency = Math.exp(-0.1 * (Date.now() - memory.timestamp));
    const relevance = memory.similarityScore;
    return (recency * 0.6) + (relevance * 0.4);
  }

  _createContextBlend(memories, currentInput) {
    const context = {
      userPreferences: this._extractPreferences(memories),
      conversationThread: this._buildConversationThread(memories),
      personalityAdjustment: this._calculatePersonalityAdjustment(memories)
    };

    return `
      <context>
        <user-profile>
          ${context.userPreferences.join('\n')}
        </user-profile>
        <conversation-thread>
          ${context.conversationThread.join('\n')}
        </conversation-thread>
        <personality-settings>
          ${JSON.stringify(context.personalityAdjustment)}
        </personality-settings>
        <current-input>
          ${currentInput}
        </current-input>
      </context>
    `;
  }

  async recallRelatedMemories(embedding) {
    return this.vectorDB.search(embedding, {
      topK: 3,
      minScore: 0.65
    });
  }
} 
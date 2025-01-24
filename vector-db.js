import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';
import fs from 'fs/promises';
import { encrypt, decrypt } from './encryption.js';
import zlib from 'zlib';

const VECTOR_STORE_PATH = './memory/vector-store.bin';
const METADATA_STORE_PATH = './memory/metadata-store.json';

export class VectorDB {
  constructor() {
    this.model = null;
    this.memoryVectors = [];
    this.memoryMetadata = [];
    this.index = null;
  }

  async initialize() {
    this.model = await use.load();
    await this.loadIndex();
  }

  async embed(text) {
    if (!this.model) await this.initialize();
    const embeddings = await this.model.embed(text);
    return embeddings.arraySync()[0];
  }

  async addMemory(text, metadata) {
    const vector = await this.embed(text);
    this.memoryVectors.push(vector);
    this.memoryMetadata.push({
      ...metadata,
      timestamp: Date.now(),
      accessCount: 0
    });
    await this.updateIndex();
  }

  async search(queryVector, options = {}) {
    const { topK = 5, minScore = 0.6 } = options;
    const results = [];
    
    // Convert to TensorFlow tensors
    const queryTensor = tf.tensor2d([queryVector]);
    const memoryTensor = tf.tensor2d(this.memoryVectors);
    
    // Calculate cosine similarity
    const normalizedQuery = tf.div(queryTensor, tf.norm(queryTensor, 'euclidean', 1));
    const normalizedMemory = tf.div(memoryTensor, tf.norm(memoryTensor, 'euclidean', 1));
    const similarity = tf.matMul(normalizedQuery, normalizedMemory, false, true);
    
    // Get top matches
    const similarities = await similarity.data();
    similarity.dispose();
    
    similarities.forEach((score, index) => {
      if (score > minScore) {
        results.push({
          score,
          text: this.memoryMetadata[index].originalText,
          metadata: this.memoryMetadata[index]
        });
      }
    });
    
    // Sort and return topK results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async updateIndex() {
    // Implement periodic index optimization
    if (this.memoryVectors.length % 100 === 0) {
      await this.optimizeIndex();
    }
  }

  async optimizeIndex() {
    // Convert to TensorFlow tensor
    const vectors = tf.tensor2d(this.memoryVectors);
    
    // Perform PCA dimensionality reduction
    const { components } = await tf.linalg.pca(vectors, 128);
    this.index = components;
    
    // Dispose tensors to free memory
    vectors.dispose();
  }

  async saveIndex() {
    // Serialize vectors
    const vectorBuffer = tf.util.encodeWeights(
      this.memoryVectors.map(v => new Float32Array(v))
    );
    
    // Compress and encrypt
    const compressedVectors = zlib.gzipSync(vectorBuffer.data);
    const encryptedVectors = encrypt(compressedVectors);
    
    // Save to file
    await fs.writeFile(VECTOR_STORE_PATH, encryptedVectors);
    
    // Save metadata
    const encryptedMetadata = encrypt(JSON.stringify(this.memoryMetadata));
    await fs.writeFile(METADATA_STORE_PATH, encryptedMetadata);
  }

  async loadIndex() {
    try {
      // Load vectors
      const encryptedVectors = await fs.readFile(VECTOR_STORE_PATH);
      const compressedVectors = decrypt(encryptedVectors);
      const vectorBuffer = zlib.gunzipSync(compressedVectors);
      
      const { weights, specs } = tf.util.decodeWeights(
        vectorBuffer.buffer,
        [{
          name: 'vectors',
          shape: [this.memoryVectors.length, 512],
          dtype: 'float32'
        }]
      );
      
      this.memoryVectors = Array.from(weights[0]);
      
      // Load metadata
      const encryptedMetadata = await fs.readFile(METADATA_STORE_PATH);
      this.memoryMetadata = JSON.parse(decrypt(encryptedMetadata));
      
    } catch (error) {
      console.log('No existing index found, initializing new database');
    }
  }

  async pruneMemories() {
    const retentionPeriod = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();
    
    const newVectors = [];
    const newMetadata = [];
    
    this.memoryMetadata.forEach((meta, index) => {
      if (now - meta.timestamp < retentionPeriod) {
        newVectors.push(this.memoryVectors[index]);
        newMetadata.push(meta);
      }
    });
    
    this.memoryVectors = newVectors;
    this.memoryMetadata = newMetadata;
    
    await this.optimizeIndex();
    await this.saveIndex();
  }

  startMaintenance() {
    setInterval(async () => {
      await this.pruneMemories();
      await this.optimizeIndex();
      await this.saveIndex();
    }, 3600000); // Every hour
  }
}
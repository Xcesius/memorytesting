import { MemoryCore } from './memory/memory-core.js';
import { PersonalityEngine } from './memory/personality-engine.js';

export async function chatCompletion(prompt, userId) {
  try {
    // Initialize memory and personality systems
    const memoryCore = new MemoryCore(userId);
    const personalityEngine = new PersonalityEngine(memoryCore.personalityMatrix);
    
    // Process input through memory system
    const context = await memoryCore.processInput(prompt);
    
    // Adapt personality based on context
    personalityEngine.adaptToMemory(context);
    const responseStyle = personalityEngine.generateResponseStyle();
    
    // Construct AI prompt
    const aiPrompt = `
      ${context}
      
      Response Guidelines:
      - Formality level: ${responseStyle.formality.toFixed(2)}
      - Humor allowance: ${responseStyle.humorLevel.toFixed(2)}
      - Use emojis: ${responseStyle.useEmojis ? 'Yes' : 'No'}
      
      Craft a response that naturally incorporates relevant memories while matching the user's communication style.
    `;

    // Get AI response
    const response = await getAIResponse(aiPrompt);
    
    // Update memory with new interaction
    await memoryCore.storeInteraction({
      input: prompt,
      response: response,
      context: context
    });

    return {
      response: response,
      thinking: aiPrompt
    };
  } catch (error) {
    throw new Error(`Chat completion failed: ${error.message}`);
  }
} 
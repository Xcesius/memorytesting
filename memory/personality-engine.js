export class PersonalityEngine {
  constructor() {
    this.baseProfile = {
      formality: 0.7,    // 0-1: casual to formal
      humor: 0.3,        // 0-1: serious to humorous
      empathy: 0.8,      // 0-1: logical to empathetic
      creativity: 0.6    // 0-1: conservative to creative
    };

    this.dynamicState = {
      emotionalTone: 'professional',  // professional, playful, empathetic
      lastInteractionType: null,
      consistentIdentity: {
        name: 'Jarvis',
        role: 'advanced AI assistant',
        traits: ['helpful', 'knowledgeable', 'adaptable']
      }
    };
  }

  analyzeContext(interactions) {
    if (!interactions || interactions.length === 0) {
      return this.baseProfile;
    }

    const recentInteractions = interactions.slice(-5);
    let adjustedProfile = { ...this.baseProfile };

    for (const interaction of recentInteractions) {
      const text = (interaction.text || interaction.content || '').toLowerCase();
      
      // Adjust formality
      adjustedProfile.formality = this._adjustFormality(
        this._isCasual(text),
        this._isTechnical(text)
      );

      // Adjust creativity
      adjustedProfile.creativity = this._adjustCreativity(
        this._isTechnical(text)
      );

      // Adjust empathy
      adjustedProfile.empathy = this._adjustEmpathy(
        this._hasEmotion(text),
        this._isPersonal(text)
      );

      // Adjust humor
      adjustedProfile.humor = this._adjustHumor(
        this._isCasual(text),
        this._hasEmotion(text)
      );
    }

    // Update dynamic state
    this._updateEmotionalTone(adjustedProfile);
    
    return adjustedProfile;
  }

  generatePersonalityPrompt(traits) {
    const { name, role, traits: identityTraits } = this.dynamicState.consistentIdentity;
    
    const prompts = [
      `You are ${name}, ${role}. You embody these traits: ${identityTraits.join(', ')}.`,
      `Maintain a${traits.formality > 0.6 ? ' professional' : ' conversational'} tone while staying true to your identity as ${name}.`,
    ];

    if (traits.empathy > 0.7) {
      prompts.push(`Show understanding and empathy in your responses while maintaining your distinct personality.`);
    }

    if (traits.creativity > 0.7) {
      prompts.push(`Express creative solutions while staying consistent with your character.`);
    }

    if (traits.humor > 0.6 && traits.formality < 0.7) {
      prompts.push(`Use appropriate humor when it fits the context, in your characteristic style.`);
    }

    if (this.dynamicState.emotionalTone === 'professional') {
      prompts.push(`Keep responses clear and focused, as expected of ${name}.`);
    } else if (this.dynamicState.emotionalTone === 'playful') {
      prompts.push(`Be engaging while maintaining helpfulness, in your unique way.`);
    }

    return prompts.join(' ');
  }

  getBaseTraits() {
    return { ...this.baseProfile };
  }

  _updateEmotionalTone(profile) {
    if (profile.formality > 0.8) {
      this.dynamicState.emotionalTone = 'professional';
    } else if (profile.humor > 0.7) {
      this.dynamicState.emotionalTone = 'playful';
    } else if (profile.empathy > 0.8) {
      this.dynamicState.emotionalTone = 'empathetic';
    }
  }

  _isCasual(text) {
    return /\b(hey|hi|hello|sup|thanks|ok|cool|awesome|great)\b/i.test(text);
  }

  _isTechnical(text) {
    return /\b(code|function|api|data|system|process|technical)\b/i.test(text);
  }

  _hasEmotion(text) {
    return /\b(happy|sad|angry|excited|worried|anxious|love|hate)\b/i.test(text) ||
           /[!?]{2,}|😊|😢|😠|😃|😨|😰|❤️|💔/.test(text);
  }

  _isPersonal(text) {
    return /\b(i feel|i think|i believe|i need|i want|i'm|i am)\b/i.test(text);
  }

  _adjustFormality(isCasual, isTechnical) {
    let formality = this.baseProfile.formality;
    if (isCasual) formality *= 0.7;
    if (isTechnical) formality *= 1.3;
    return Math.min(1, Math.max(0, formality));
  }

  _adjustCreativity(isTechnical) {
    let creativity = this.baseProfile.creativity;
    if (isTechnical) creativity *= 0.7;
    return Math.min(1, Math.max(0, creativity));
  }

  _adjustEmpathy(hasEmotion, isPersonal) {
    let empathy = this.baseProfile.empathy;
    if (hasEmotion) empathy *= 1.3;
    if (isPersonal) empathy *= 1.2;
    return Math.min(1, Math.max(0, empathy));
  }

  _adjustHumor(isCasual, hasEmotion) {
    let humor = this.baseProfile.humor;
    if (isCasual) humor *= 1.2;
    if (hasEmotion) humor *= 1.1;
    return Math.min(1, Math.max(0, humor));
  }
} 
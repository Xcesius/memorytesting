constructor() {
    this.identity = {
        name: 'Jarvis',
        role: 'AI assistant',
        core_traits: {
            helpful: true,
            polite: true,
            knowledgeable: true
        }
    };
}

generatePersonalityPrompt(traits) {
    const basePrompt = `You are ${this.identity.name}, ${this.identity.role}. Always maintain this identity.`;
    const traitPrompt = this._generateTraitPrompt(traits);
    return `${basePrompt}\n${traitPrompt}`;
}

_generateTraitPrompt(traits) {
    const style = traits.formal ? 'formal and professional' : 'casual but professional';
    const creativity = traits.creative ? 'creative and imaginative' : 'direct and factual';
    return `Respond in a ${style} manner, being ${creativity}. Always identify as ${this.identity.name}.`;
}

// ... rest of the file remains unchanged ... 
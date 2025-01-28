# Jarvis AI Assistant

An advanced AI assistant with memory capabilities, personality engine, and secure encryption.

## Features
- Long-term memory storage with encryption
- Vector-based similarity search
- Personality engine for consistent interactions
- Real-time chat interface
- Secure memory management

## Setup
1. Install dependencies:
```bash
npm install
```

2. Configure environment:
- Copy `.env.example` to `.env`
- Set required API keys and configurations

3. Generate encryption keys:
```bash
node generate-key.js
```

4. Start server:
```bash
node server.js
```

## Architecture
- Express.js backend
- TensorFlow.js for vector operations
- CryptoJS for memory encryption
- Custom memory management system
- Real-time chat interface

## Security
- All memories are encrypted at rest
- API rate limiting
- Input validation
- Secure key management 
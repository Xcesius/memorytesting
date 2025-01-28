document.addEventListener('DOMContentLoaded', loadPreviousMessages);

const chatMessages = document.getElementById('chat-messages');
const promptInput = document.getElementById('prompt-input');
const sendButton = document.getElementById('send-button');
let currentConversationId = null;

// Add conversation UI elements
const conversationInfo = document.createElement('div');
conversationInfo.id = 'conversation-info';
conversationInfo.className = 'conversation-info';
document.querySelector('.chat-container').insertBefore(conversationInfo, chatMessages);

sendButton.addEventListener('click', sendMessage);

promptInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        sendMessage();
        event.preventDefault(); // Prevent default form submission
    }
});

let lastMessageTime = 0;
const MIN_MESSAGE_LENGTH = 1;
const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_MS = 1000; // 1 second between messages

function validateMessage(text) {
    if (text.length < MIN_MESSAGE_LENGTH) {
        throw new Error('Message too short');
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
    }
    
    const now = Date.now();
    if (now - lastMessageTime < RATE_LIMIT_MS) {
        throw new Error('Please wait before sending another message');
    }
    return true;
}

function addMessage(text, sender, isThinking = false) {
    if (isThinking) {
        addThinkingMessage(text); // Call new function for thinking messages
        return; // Don't add to chat-messages div
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(`${sender}-message`);
    
    // Safely escape HTML
    const textNode = document.createTextNode(text);
    messageDiv.appendChild(textNode);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addThinkingMessage(text) {
    const thinkingOutput = document.getElementById('thinking-output');
    if (thinkingOutput) {
        console.log('addThinkingMessage called with text:', text); // Debugging log
        thinkingOutput.textContent += text + '\n'; // Append thinking messages with line breaks
    }
}

function clearThinkingDisplay() {
    const thinkingOutput = document.getElementById('thinking-output');
    if (thinkingOutput) {
        thinkingOutput.textContent = ''; // Clear the thinking output area
    }
}

function updateThinkingDisplay(tokens) {
    const thinkingOutput = document.getElementById('thinking-output');
    if (thinkingOutput) {
        thinkingOutput.textContent = `Tokens used: ${tokens}`;
    }
}

function updatePersonalityDisplay() {
    const traits = persona.getTraits();
    document.getElementById('personality-humor').style.width = `${traits.humor * 100}%`;
    document.getElementById('personality-empathy').style.width = `${traits.empathy * 100}%`;
    // Update other trait indicators
}

function updateConversationInfo(contextSummary) {
    if (!contextSummary) return;
    
    conversationInfo.innerHTML = `
        <span>Messages: ${contextSummary.exchangeCount || 0}</span>
        ${contextSummary.firstTimestamp ? 
            `<span>Started: ${new Date(contextSummary.firstTimestamp).toLocaleTimeString()}</span>` 
            : ''}
        <button onclick="startNewConversation()" class="new-conv-btn">New Conversation</button>
    `;
}

function startNewConversation() {
    currentConversationId = null;
    chatMessages.innerHTML = '';
    conversationInfo.innerHTML = '';
    promptInput.focus();
}

async function sendMessage() {
    const promptText = promptInput.value.trim();
    if (!promptText) return;

    if (!validateMessage(promptText)) {
        alert('Message validation failed. Check console for details.');
        return;
    }

    addMessage(promptText, 'user');
    promptInput.value = '';
    lastMessageTime = Date.now();
    clearThinkingDisplay(); // Clear previous thinking messages before new response

    try {
        console.log('Sending request to backend:', {
            prompt: promptText,
            conversationId: currentConversationId
        });

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                prompt: promptText,
                conversationId: currentConversationId
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Received response:', data);
        
        currentConversationId = data.conversationId;
        addMessage(data.response, 'bot');

        // Display thinking messages in the thinking area
        if (data.thinking) {
            console.log('data.thinking:', data.thinking);
            addThinkingMessage(data.thinking);
            updateThinkingDisplay(data.tokens); // Update token count
        } else if (data.tokens) {
            updateThinkingDisplay(data.tokens); // Update token count even if no thinking
        }
        updateConversationInfo(data.contextSummary);

    } catch (error) {
        console.error('Error:', error);
        addMessage(`Error: ${error.message}`, 'system');
    } finally {
        promptInput.focus();
    }
}

async function loadPreviousMessages() {
    try {
        const response = await fetch('/api/memory');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.messages) {
            let lastConversationId = null;
            data.messages.forEach(message => {
                if (message.conversationId !== lastConversationId) {
                    addConversationDivider(message.timestamp);
                    lastConversationId = message.conversationId;
                }
                addMessage(message.text, 'user');
                addMessage(message.response, 'bot');
            });
        }
    } catch (error) {
        console.error('Error loading previous messages:', error);
        addMessage('Error loading previous messages', 'system');
    }
}

function addConversationDivider(timestamp) {
    const divider = document.createElement('div');
    divider.className = 'conversation-divider';
    divider.textContent = `Conversation from ${new Date(timestamp).toLocaleString()}`;
    chatMessages.appendChild(divider);
}
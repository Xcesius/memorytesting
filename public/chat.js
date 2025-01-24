document.addEventListener('DOMContentLoaded', loadPreviousMessages);

const chatMessages = document.getElementById('chat-messages');
const promptInput = document.getElementById('prompt-input');
const sendButton = document.getElementById('send-button');

sendButton.addEventListener('click', sendMessage);

promptInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        sendMessage();
        event.preventDefault(); // Prevent default form submission
    }
});

function addMessage(text, sender, isThinking = false) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(`${sender}-message`);
    if (isThinking) {
        messageDiv.classList.add('thinking-message');
    }
    messageDiv.innerHTML = text; // Use innerHTML to render <think> tags as HTML (for CSS targeting)
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateThinkingDisplay(content) {
    const thinkingOutput = document.getElementById('thinking-output');
    thinkingOutput.textContent = content;
    thinkingOutput.scrollTop = thinkingOutput.scrollHeight;
}

function updatePersonalityDisplay() {
    const traits = persona.getTraits();
    document.getElementById('personality-humor').style.width = `${traits.humor * 100}%`;
    document.getElementById('personality-empathy').style.width = `${traits.empathy * 100}%`;
    // Update other trait indicators
}

async function sendMessage() {
    const messageText = promptInput.value.trim();
    if (!messageText) return;

    addMessage(messageText, 'user');
    promptInput.value = '';

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: messageText })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        addMessage(data.response, 'bot');
        updateThinkingDisplay(data.thinking);
        updatePersonalityDisplay();
        updateMemoryVisualization(memorySystem.getRecentMemories());

    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Error: Could not send message.', 'bot');
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
            data.messages.forEach(message => {
                addMessage(message.text, 'user');
                addMessage(message.response, 'bot');
            });
        }
    } catch (error) {
        console.error('Error loading previous messages:', error);
    }
}
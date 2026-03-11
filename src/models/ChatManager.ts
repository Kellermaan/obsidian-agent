import { Conversation, Message, ChatState } from './types';

export class ChatManager {
	private state: ChatState;

	constructor() {
		this.state = {
			conversations: [],
			activeConversationId: null
		};
	}

	loadState(state: ChatState) {
		this.state = state;
	}

	getState(): ChatState {
		return this.state;
	}

	createConversation(title: string = 'New Chat'): Conversation {
		const newConversation: Conversation = {
			id: crypto.randomUUID(),
			title,
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		this.state.conversations.push(newConversation);
		this.state.activeConversationId = newConversation.id;
		return newConversation;
	}

	deleteConversation(id: string) {
		this.state.conversations = this.state.conversations.filter(c => c.id !== id);
		if (this.state.activeConversationId === id) {
			const first = this.state.conversations[0];
			this.state.activeConversationId = first ? first.id : null;
		}
	}

	getActiveConversation(): Conversation | null {
		return this.state.conversations.find(c => c.id === this.state.activeConversationId) || null;
	}

	setActiveConversation(id: string) {
		this.state.activeConversationId = id;
	}

	addMessage(conversationId: string, role: 'user' | 'assistant' | 'system', content: string): Message {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) throw new Error('Conversation not found');

		const message: Message = {
			id: crypto.randomUUID(),
			role,
			content,
			timestamp: Date.now()
		};
		conversation.messages.push(message);
		conversation.updatedAt = Date.now();
		return message;
	}

	updateMessage(conversationId: string, messageId: string, content: string) {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) return;

		const message = conversation.messages.find(m => m.id === messageId);
		if (message) {
			message.content = content;
			conversation.updatedAt = Date.now();
		}
	}
}

import { AgentUndoOperation, ContextAttachment, Conversation, Message, ChatState } from './types';

export class ChatManager {
	private state: ChatState;

	constructor() {
		this.state = {
			conversations: [],
			activeConversationId: null
		};
	}

	loadState(state: ChatState) {
		this.state = {
			conversations: state.conversations.map((conversation) => ({
				...conversation,
				contextItems: conversation.contextItems ?? [],
			})),
			activeConversationId: state.activeConversationId,
		};
	}

	getState(): ChatState {
		return this.state;
	}

	createConversation(title: string = 'New Chat'): Conversation {
		const newConversation: Conversation = {
			id: crypto.randomUUID(),
			title,
			messages: [],
			contextItems: [],
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

	clearConversationHistory(id: string) {
		const conversation = this.state.conversations.find(c => c.id === id);
		if (!conversation) return;

		conversation.messages = [];
		conversation.updatedAt = Date.now();
	}

	getActiveConversation(): Conversation | null {
		return this.state.conversations.find(c => c.id === this.state.activeConversationId) || null;
	}

	getConversations(): Conversation[] {
		return [...this.state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	setActiveConversation(id: string) {
		const exists = this.state.conversations.some((conversation) => conversation.id === id);
		if (exists) {
			this.state.activeConversationId = id;
		}
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
		if (role === 'user' && conversation.messages.length === 1) {
			conversation.title = this.createTitleFromMessage(content);
		}
		conversation.updatedAt = Date.now();
		return message;
	}

	addContextItem(conversationId: string, item: Omit<ContextAttachment, 'id' | 'createdAt'>): ContextAttachment {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) throw new Error('Conversation not found');

		const contextItem: ContextAttachment = {
			id: crypto.randomUUID(),
			createdAt: Date.now(),
			...item,
		};

		conversation.contextItems.push(contextItem);
		conversation.updatedAt = Date.now();
		return contextItem;
	}

	removeContextItem(conversationId: string, contextItemId: string) {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) return;

		conversation.contextItems = conversation.contextItems.filter((item) => item.id !== contextItemId);
		conversation.updatedAt = Date.now();
	}

	upsertAutoActiveFileContext(conversationId: string, item: Omit<ContextAttachment, 'id' | 'createdAt'>): boolean {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) return false;

		const existing = conversation.contextItems.find((contextItem) => contextItem.isAutoActiveFile);
		if (existing) {
			const changed = existing.type !== item.type
				|| existing.label !== item.label
				|| existing.content !== item.content
				|| existing.sourcePath !== item.sourcePath
				|| existing.isAutoActiveFile !== true;
			if (!changed) {
				return false;
			}

			existing.type = item.type;
			existing.label = item.label;
			existing.content = item.content;
			existing.sourcePath = item.sourcePath;
			existing.isAutoActiveFile = true;
			conversation.updatedAt = Date.now();
			return true;
		}

		const contextItem: ContextAttachment = {
			id: crypto.randomUUID(),
			createdAt: Date.now(),
			...item,
			isAutoActiveFile: true,
		};

		conversation.contextItems.push(contextItem);
		conversation.updatedAt = Date.now();
		return true;
	}

	removeAutoActiveFileContext(conversationId: string): boolean {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) return false;

		const before = conversation.contextItems.length;
		conversation.contextItems = conversation.contextItems.filter((item) => !item.isAutoActiveFile);
		const changed = conversation.contextItems.length !== before;
		if (changed) {
			conversation.updatedAt = Date.now();
		}

		return changed;
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

	setMessageUndoOperations(conversationId: string, messageId: string, operations: AgentUndoOperation[]) {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) return;

		const message = conversation.messages.find(m => m.id === messageId);
		if (!message) return;

		message.agentUndoOperations = operations;
		message.agentUndoState = operations.length > 0 ? 'available' : undefined;
		conversation.updatedAt = Date.now();
	}

	setMessageUndoState(conversationId: string, messageId: string, state: 'available' | 'applied' | 'failed') {
		const conversation = this.state.conversations.find(c => c.id === conversationId);
		if (!conversation) return;

		const message = conversation.messages.find(m => m.id === messageId);
		if (!message) return;

		message.agentUndoState = state;
		conversation.updatedAt = Date.now();
	}

	private createTitleFromMessage(content: string): string {
		const compact = content.replace(/\s+/g, ' ').trim();
		if (!compact) return 'New chat';
		return compact.length > 40 ? `${compact.slice(0, 40)}...` : compact;
	}
}

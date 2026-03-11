export interface Message {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
	agentUndoOperations?: AgentUndoOperation[];
	agentUndoState?: 'available' | 'applied' | 'failed';
}

export type AgentUndoOperation =
	| {
		type: 'restore_file';
		path: string;
		content: string;
	}
	| {
		type: 'delete_path';
		path: string;
	}
	| {
		type: 'rename_path';
		oldPath: string;
		newPath: string;
	};

export interface ContextAttachment {
	id: string;
	type: 'file' | 'selection';
	label: string;
	content: string;
	sourcePath?: string;
	createdAt: number;
}

export interface Conversation {
	id: string;
	title: string;
	messages: Message[];
	contextItems: ContextAttachment[];
	createdAt: number;
	updatedAt: number;
}

export interface ChatState {
	conversations: Conversation[];
	activeConversationId: string | null;
}

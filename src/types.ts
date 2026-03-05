export interface ChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: object;
	};
}

export interface CompletionResult {
	content: string;
	toolCalls: ToolCall[];
}

export interface AgentToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface AgentToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface AgentMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCallId?: string;
	toolCalls?: AgentToolCall[];
}

export interface AgentModelResponse {
	content: string;
	toolCalls: AgentToolCall[];
}

export interface LLMService {
	streamResponse(
		messages: { role: string; content: string }[],
		onChunk: (chunk: string) => void,
		onError: (error: Error) => void,
		onComplete: () => void
	): Promise<void>;

	generateAgentResponse(
		messages: AgentMessage[],
		tools: AgentToolDefinition[]
	): Promise<AgentModelResponse>;
}

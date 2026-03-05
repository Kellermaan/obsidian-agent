export interface ChatMessage {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
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
		parameters: {
			type: string;
			properties: Record<string, object>;
			required?: string[];
		};
	};
}

export interface StreamDelta {
	choices: Array<{
		delta: {
			content?: string;
			role?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
}

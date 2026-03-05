import { AgentPluginSettings } from '../settings';
import { ChatMessage, CompletionResult, ToolCall, ToolDefinition } from '../types';

export class AIClient {
	constructor(private settings: AgentPluginSettings) {}

	/**
	 * Stream a chat completion from the configured API.
	 * Text chunks are delivered via `onTextChunk` as they arrive.
	 * Returns the full result (text + tool calls) once the stream is done.
	 */
	async streamChat(
		messages: ChatMessage[],
		tools: ToolDefinition[],
		onTextChunk: (chunk: string) => void
	): Promise<CompletionResult> {
		const url = `${this.settings.apiUrl.replace(/\/$/, '')}/chat/completions`;

		const body: Record<string, unknown> = {
			model: this.settings.model,
			messages,
			max_tokens: this.settings.maxTokens,
			temperature: this.settings.temperature,
			stream: true,
		};

		if (tools.length > 0) {
			body.tools = tools;
			body.tool_choice = 'auto';
		}

		let response: Response;
		try {
			// fetch is required here instead of requestUrl because we need streaming (ReadableStream).
			// requestUrl buffers the entire response and does not support SSE streaming.
			// eslint-disable-next-line no-restricted-globals
			response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.settings.apiKey}`,
				},
				body: JSON.stringify(body),
			});
		} catch (err) {
			throw new Error(`Network error: ${String(err)}`);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new Error(`API error ${response.status}: ${text}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body from API');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let fullText = '';
		// index → accumulated ToolCall
		const toolCalls = new Map<number, ToolCall>();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Split on newlines; keep any incomplete line in the buffer
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === 'data: [DONE]') continue;
					if (!trimmed.startsWith('data: ')) continue;

					let chunk: StreamChunk;
					try {
						chunk = JSON.parse(trimmed.slice(6)) as StreamChunk;
					} catch {
						continue;
					}

					const delta = chunk.choices?.[0]?.delta;
					if (!delta) continue;

					// Plain text
					if (typeof delta.content === 'string' && delta.content) {
						fullText += delta.content;
						onTextChunk(delta.content);
					}

					// Tool call deltas
					if (Array.isArray(delta.tool_calls)) {
						for (const tc of delta.tool_calls) {
							const idx: number = tc.index ?? 0;
							if (!toolCalls.has(idx)) {
								toolCalls.set(idx, {
									id: tc.id ?? '',
									type: 'function',
									function: {
										name: tc.function?.name ?? '',
										arguments: tc.function?.arguments ?? '',
									},
								});
							} else {
								const existing = toolCalls.get(idx)!;
								if (tc.id && !existing.id) existing.id = tc.id;
								if (tc.function?.name) existing.function.name += tc.function.name;
								if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
							}
						}
					}
				}
			}
		} finally {
			reader.cancel().catch(() => {
				/* ignore */
			});
		}

		return {
			content: fullText,
			toolCalls: [...toolCalls.values()].filter(tc => tc.function.name),
		};
	}
}

// Minimal typing for the SSE stream chunks we care about
interface StreamChunk {
	choices?: Array<{
		delta?: {
			content?: string;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason?: string;
	}>;
}

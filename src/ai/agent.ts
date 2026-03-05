import { App } from 'obsidian';
import { ChatMessage, ToolCall } from '../types';
import { AgentPluginSettings } from '../settings';
import { AIClient } from './client';
import { ToolExecutor, TOOL_DEFINITIONS, EditRequest } from './tools';
import { DiffModal } from '../ui/diff-modal';

export interface AgentCallbacks {
	/** Called when a new assistant turn starts (streaming or not). */
	onAssistantStart: () => void;
	/** Called for each streaming token (streaming mode only). */
	onAssistantToken: (token: string) => void;
	/** Called when the assistant turn is complete. */
	onAssistantComplete: (content: string | null) => void;
	/** Called just before a tool is executed. */
	onToolCall: (toolName: string, args: string) => void;
	/** Called after a tool execution completes (or is rejected). */
	onToolResult: (toolName: string, result: string, success: boolean) => void;
	/** Called if a fatal error occurs. */
	onError: (error: string) => void;
}

const MAX_ITERATIONS = 10;

export class Agent {
	private app: App;
	private settings: AgentPluginSettings;
	private client: AIClient;
	private executor: ToolExecutor;

	constructor(app: App, settings: AgentPluginSettings) {
		this.app = app;
		this.settings = settings;
		this.client = new AIClient(settings);
		this.executor = new ToolExecutor(app);
	}

	updateSettings(settings: AgentPluginSettings): void {
		this.settings = settings;
		this.client = new AIClient(settings);
	}

	/**
	 * Run the agent loop given a conversation history.
	 * Returns the updated history (without the prepended system message).
	 */
	async run(history: ChatMessage[], callbacks: AgentCallbacks): Promise<ChatMessage[]> {
		const messages: ChatMessage[] = [
			{ role: 'system', content: this.settings.systemPrompt },
			...history,
		];

		for (let i = 0; i < MAX_ITERATIONS; i++) {
			const assistantMessage = await this.callModel(messages, callbacks);
			messages.push(assistantMessage);

			// No tool calls → the agent has finished
			if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
				break;
			}

			// Execute every tool call sequentially
			for (const toolCall of assistantMessage.tool_calls) {
				const resultText = await this.executeToolCall(toolCall, callbacks);
				messages.push({
					role: 'tool',
					content: resultText,
					tool_call_id: toolCall.id,
					name: toolCall.function.name,
				});
			}
		}

		// Return history without the system message
		return messages.slice(1);
	}

	// ── private helpers ──────────────────────────────────────────────────────

	private async callModel(
		messages: ChatMessage[],
		callbacks: AgentCallbacks,
	): Promise<ChatMessage> {
		callbacks.onAssistantStart();

		if (this.settings.streamResponse) {
			let finalMessage: ChatMessage | null = null;

			for await (const chunk of this.client.streamComplete(messages, TOOL_DEFINITIONS as object[])) {
				if (chunk.type === 'token') {
					callbacks.onAssistantToken(chunk.content);
				} else {
					finalMessage = chunk.message;
				}
			}

			const msg = finalMessage ?? { role: 'assistant' as const, content: null };
			callbacks.onAssistantComplete(msg.content);
			return msg;
		} else {
			const msg = await this.client.complete(messages, TOOL_DEFINITIONS as object[]);
			callbacks.onAssistantComplete(msg.content);
			return msg;
		}
	}

	private async executeToolCall(
		toolCall: ToolCall,
		callbacks: AgentCallbacks,
	): Promise<string> {
		const { name, arguments: argsJson } = toolCall.function;
		callbacks.onToolCall(name, argsJson);

		const result = await this.executor.execute(name, argsJson);

		// If this is a write/patch operation, request user confirmation (unless auto-apply is on)
		if (result.editRequest) {
			return this.handleEditRequest(result.editRequest, callbacks);
		}

		callbacks.onToolResult(name, result.result, result.success);
		return result.result;
	}

	private async handleEditRequest(
		editRequest: EditRequest,
		callbacks: AgentCallbacks,
	): Promise<string> {
		if (this.settings.autoApplyEdits) {
			await this.executor.applyEdit(editRequest);
			const msg = `Edit applied to: ${editRequest.path}`;
			callbacks.onToolResult('write', msg, true);
			return msg;
		}

		// Show diff modal and wait for the user's decision
		const accepted = await this.promptUser(editRequest);
		if (accepted) {
			await this.executor.applyEdit(editRequest);
			const msg = `Edit applied to: ${editRequest.path}`;
			callbacks.onToolResult('write', msg, true);
			return msg;
		} else {
			const msg = `User rejected the edit to: ${editRequest.path}`;
			callbacks.onToolResult('write', msg, false);
			return msg;
		}
	}

	private promptUser(editRequest: EditRequest): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			new DiffModal(this.app, editRequest, () => resolve(true), () => resolve(false)).open();
		});
	}
}

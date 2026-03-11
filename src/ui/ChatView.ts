import { ButtonComponent, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, Setting, TextAreaComponent, WorkspaceLeaf } from 'obsidian';
import AgentPlugin from '../main';
import { ChatManager } from '../models/ChatManager';
import { AgentUndoOperation } from '../models/types';
import { AgentMessage, AgentToolDefinition } from '../services/LLMService';
import { VaultAgentService } from '../services/VaultAgentService';

export const VIEW_TYPE_CHAT = 'agent-chat-view';

export class ChatView extends ItemView {
	plugin: AgentPlugin;
	chatManager: ChatManager;
	vaultAgentService: VaultAgentService;
	conversationListEl: HTMLElement;
	contextListEl: HTMLElement;
	chatContainer: HTMLElement;
	inputComponent: TextAreaComponent;
	agentModeEnabled: boolean;

	constructor(leaf: WorkspaceLeaf, plugin: AgentPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.chatManager = plugin.chatManager;
		this.vaultAgentService = new VaultAgentService(plugin.app);
		this.agentModeEnabled = false;
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		return 'Agent chat';
	}

	getIcon() {
		return 'bot';
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement | undefined;
		if (!container) return;

		container.empty();
		container.addClass('agent-view-container');

		const header = container.createDiv({ cls: 'agent-header' });
		header.createEl('h3', { text: 'Chat' });

		const headerActions = header.createDiv({ cls: 'agent-header-actions' });
		const agentModeButton = new ButtonComponent(headerActions);
		agentModeButton.setButtonText('Agent mode: off').onClick(() => {
			this.agentModeEnabled = !this.agentModeEnabled;
			agentModeButton.setButtonText(this.agentModeEnabled ? 'Agent mode: on' : 'Agent mode: off');
		});

		const newChatBtn = new ButtonComponent(headerActions);
		newChatBtn.setIcon('plus').setTooltip('New chat').onClick(() => {
			this.chatManager.createConversation('New chat');
			void this.plugin.saveChatHistory();
			this.renderConversationList();
			this.renderContextItems();
			void this.renderMessages();
		});

		const addFileContextBtn = new ButtonComponent(headerActions);
		addFileContextBtn.setButtonText('Add file').onClick(() => {
			void this.addCurrentFileContext();
		});

		const addSelectionContextBtn = new ButtonComponent(headerActions);
		addSelectionContextBtn.setButtonText('Add selection').onClick(() => {
			void this.addCurrentSelectionContext();
		});

		const body = container.createDiv({ cls: 'agent-body' });
		const sidebar = body.createDiv({ cls: 'agent-conversation-sidebar' });
		sidebar.createDiv({ cls: 'agent-sidebar-title', text: 'Conversations' });
		this.conversationListEl = sidebar.createDiv({ cls: 'agent-conversation-list' });

		const main = body.createDiv({ cls: 'agent-main' });
		this.contextListEl = main.createDiv({ cls: 'agent-context-list' });

		this.chatContainer = main.createDiv({ cls: 'agent-messages' });
		
		const inputContainer = main.createDiv({ cls: 'agent-input-area' });
		this.inputComponent = new TextAreaComponent(inputContainer);
		this.inputComponent.setPlaceholder('Ask agent...');
		this.inputComponent.inputEl.addClass('agent-chat-input');
		this.inputComponent.inputEl.rows = 3;

		this.inputComponent.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				void this.handleSend();
			}
		});

		const sendButton = new ButtonComponent(inputContainer);
		sendButton.setIcon('send');
		sendButton.onClick(() => {
			void this.handleSend();
		});

		if (!this.chatManager.getActiveConversation()) {
			this.chatManager.createConversation('New chat');
		}

		this.renderConversationList();
		this.renderContextItems();
		void this.renderMessages();
	}

	async handleSend() {
		const content = this.inputComponent.getValue();
		if (!content.trim()) return;

		this.inputComponent.setValue('');
		
		let conversation = this.chatManager.getActiveConversation();
		if (!conversation) {
			conversation = this.chatManager.createConversation('New chat');
			this.renderConversationList();
		}

		this.chatManager.addMessage(conversation.id, 'user', content);
		void this.plugin.saveChatHistory();
		this.renderConversationList();
		await this.renderMessages();

		if (this.agentModeEnabled) {
			await this.generateAgentResponse();
		} else {
			await this.generateResponse();
		}
	}

	async generateAgentResponse() {
		const conversation = this.chatManager.getActiveConversation();
		if (!conversation) return;

		const loadingMsg = this.chatManager.addMessage(conversation.id, 'assistant', 'Agent is planning...');
		await this.renderMessages();

		try {
			const undoOperations: AgentUndoOperation[] = [];
			const workingMessages: AgentMessage[] = conversation.messages
				.filter((message) => message.id !== loadingMsg.id)
				.map((message) => ({ role: message.role, content: message.content }));

			const contextPrompt = this.buildContextPrompt(conversation.id);
			if (contextPrompt) {
				workingMessages.unshift({ role: 'system', content: contextPrompt });
			}

			workingMessages.unshift({
				role: 'system',
				content: 'You are an Obsidian vault agent. Use tools when file operations are required. Keep operations precise and minimal.',
			});

			const tools = this.getAgentTools();
			let finalAnswer = '';

			for (let step = 0; step < 6; step++) {
				const response = await this.plugin.llmService.generateAgentResponse(workingMessages, tools);

				if (response.toolCalls.length === 0) {
					finalAnswer = response.content || 'Done.';
					break;
				}

				workingMessages.push({
					role: 'assistant',
					content: response.content,
					toolCalls: response.toolCalls,
				});

				for (const toolCall of response.toolCalls) {
					const execution = await this.executeAgentTool(toolCall.name, toolCall.arguments);
					if (execution.undoOperation) {
						undoOperations.push(execution.undoOperation);
					}
					workingMessages.push({
						role: 'tool',
						content: execution.result,
						toolCallId: toolCall.id,
					});
				}
			}

			if (!finalAnswer) {
				finalAnswer = 'Agent finished tool calls. Please ask me to summarize results if needed.';
			}

			this.chatManager.updateMessage(conversation.id, loadingMsg.id, finalAnswer);
			this.chatManager.setMessageUndoOperations(conversation.id, loadingMsg.id, undoOperations);
			await this.renderMessages();
			void this.plugin.saveChatHistory();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown agent error';
			this.chatManager.updateMessage(conversation.id, loadingMsg.id, `Agent error: ${message}`);
			await this.renderMessages();
		}
	}

	async generateResponse() {
		const conversation = this.chatManager.getActiveConversation();
		if (!conversation) return;

		const loadingMsg = this.chatManager.addMessage(conversation.id, 'assistant', 'Thinking...');
		await this.renderMessages();

		try {
			let currentContent = '';
			
			const history = conversation.messages
				.filter(m => m.id !== loadingMsg.id)
				.map(m => ({ role: m.role, content: m.content }));

			const contextPrompt = this.buildContextPrompt(conversation.id);
			const messagesForModel = contextPrompt
				? [{ role: 'system', content: contextPrompt }, ...history]
				: history;

			await this.plugin.llmService.streamResponse(
				messagesForModel,
				(chunk) => {
					currentContent += chunk;
					this.chatManager.updateMessage(conversation.id, loadingMsg.id, currentContent);
					void this.updateLastMessage(currentContent);
				},
				(error) => {
					new Notice(`Error: ${error.message}`);
					this.chatManager.updateMessage(conversation.id, loadingMsg.id, `Error: ${error.message}`);
					void this.renderMessages();
				},
				() => {
					this.renderConversationList();
					void this.plugin.saveChatHistory();
				}
			);
		} catch (e) {
			console.error(e);
			new Notice('Failed to send message');
		}
	}

	async updateLastMessage(content: string) {
		const messages = this.chatContainer.querySelectorAll('.agent-message-content');
		if (messages.length > 0) {
			const lastMessage = messages[messages.length - 1];
			if (!lastMessage || !(lastMessage instanceof HTMLElement)) return;
			lastMessage.empty();
			await MarkdownRenderer.render(this.plugin.app, content, lastMessage, '', this);
			this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
		}
	}

	async renderMessages() {
		this.chatContainer.empty();
		const conversation = this.chatManager.getActiveConversation();
		if (!conversation) {
			this.chatContainer.createDiv({ cls: 'agent-empty-state', text: 'Create or select a conversation to start.' });
			return;
		}

		for (const msg of conversation.messages) {
			const msgDiv = this.chatContainer.createDiv({ cls: `agent-message ${msg.role}` });
			const metaRow = msgDiv.createDiv({ cls: 'agent-message-meta' });
			metaRow.createDiv({ cls: 'agent-message-role', text: msg.role === 'user' ? 'You' : 'Agent' });

			const actionRow = metaRow.createDiv({ cls: 'agent-message-actions' });

			if (msg.role === 'assistant' && msg.agentUndoOperations && msg.agentUndoOperations.length > 0 && msg.agentUndoState !== 'applied') {
				const undoBtn = new ButtonComponent(actionRow);
				undoBtn.setClass('agent-message-undo-btn');
				undoBtn.setButtonText('Revert');
				undoBtn.setTooltip('Revert all operations from this response');
				undoBtn.onClick(() => {
					void this.revertAgentOperations(conversation.id, msg.id, msg.agentUndoOperations ?? []);
				});
			}

			const copyBtn = new ButtonComponent(actionRow);
			copyBtn.setClass('agent-message-copy-btn');
			copyBtn.setIcon('copy');
			copyBtn.setTooltip('Copy message');
			copyBtn.onClick(() => {
				void this.copyMessageContent(msg.content);
			});

			const contentDiv = msgDiv.createDiv({ cls: 'agent-message-content' });
			
			await MarkdownRenderer.render(this.plugin.app, msg.content, contentDiv, '', this);
		}
		
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	renderConversationList() {
		if (!this.conversationListEl) return;
		this.conversationListEl.empty();

		const activeConversationId = this.chatManager.getActiveConversation()?.id;
		for (const conversation of this.chatManager.getConversations()) {
			const row = this.conversationListEl.createDiv({ cls: 'agent-conversation-row' });
			if (conversation.id === activeConversationId) {
				row.addClass('is-active');
			}

			const titleButton = new ButtonComponent(row);
			titleButton.setClass('agent-conversation-title-btn');
			titleButton.setButtonText(conversation.title || 'New chat');
			titleButton.onClick(() => {
				this.chatManager.setActiveConversation(conversation.id);
				this.renderConversationList();
				this.renderContextItems();
				void this.renderMessages();
			});

			const removeButton = new ButtonComponent(row);
			removeButton.setClass('agent-conversation-delete-btn');
			removeButton.setIcon('trash');
			removeButton.setTooltip('Delete conversation');
			removeButton.onClick(() => {
				this.chatManager.deleteConversation(conversation.id);
				void this.plugin.saveChatHistory();
				this.renderConversationList();
				this.renderContextItems();
				void this.renderMessages();
			});
		}
	}

	renderContextItems() {
		if (!this.contextListEl) return;
		this.contextListEl.empty();

		const conversation = this.chatManager.getActiveConversation();
		if (!conversation || conversation.contextItems.length === 0) {
			this.contextListEl.createDiv({ cls: 'agent-context-hint', text: 'No context attached. Add file or selection.' });
			return;
		}

		for (const item of conversation.contextItems) {
			const chip = this.contextListEl.createDiv({ cls: 'agent-context-chip' });
			chip.createSpan({ cls: 'agent-context-chip-label', text: `${item.type}: ${item.label}` });

			const removeButton = new ButtonComponent(chip);
			removeButton.setIcon('x');
			removeButton.setTooltip('Remove context');
			removeButton.onClick(() => {
				this.chatManager.removeContextItem(conversation.id, item.id);
				void this.plugin.saveChatHistory();
				this.renderContextItems();
			});
		}
	}

	private async addCurrentFileContext() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.file) {
			new Notice('Open a note first to add file context.');
			return;
		}

		await this.plugin.addFileContextToActiveConversation(markdownView.file);
	}

	private async addCurrentSelectionContext() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.editor) {
			new Notice('Open a note first to add selection context.');
			return;
		}

		const selection = markdownView.editor.getSelection().trim();
		if (!selection) {
			new Notice('Select text first to add selection context.');
			return;
		}

		const file = markdownView.file;
		await this.plugin.addSelectionContextToActiveConversation(selection, file ?? undefined);
	}

	private buildContextPrompt(conversationId: string): string | null {
		const conversation = this.chatManager.getConversations().find((item) => item.id === conversationId);
		if (!conversation || conversation.contextItems.length === 0) {
			return null;
		}

		const blocks = conversation.contextItems.map((item, index) => {
			const header = item.type === 'file' ? `File context ${index + 1}` : `Selection context ${index + 1}`;
			const source = item.sourcePath ? `Source: ${item.sourcePath}` : 'Source: unknown';
			return `${header}\n${source}\n\n\`\`\`\n${item.content}\n\`\`\``;
		});

		return `You are given attached context from the user vault.\nUse it as primary reference when relevant to the question.\nIf the question needs data not present in context, say what is missing.\n\n${blocks.join('\n\n---\n\n')}`;
	}

	private getAgentTools(): AgentToolDefinition[] {
		return [
			{
				type: 'function',
				function: {
					name: 'list_files',
					description: 'List markdown files in the vault.',
					parameters: {
						type: 'object',
						properties: {
							limit: { type: 'number' },
						},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'read_file',
					description: 'Read file content by path.',
					parameters: {
						type: 'object',
						required: ['path'],
						properties: {
							path: { type: 'string' },
						},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'write_file',
					description: 'Create or overwrite file content.',
					parameters: {
						type: 'object',
						required: ['path', 'content'],
						properties: {
							path: { type: 'string' },
							content: { type: 'string' },
						},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'append_file',
					description: 'Append content to existing file.',
					parameters: {
						type: 'object',
						required: ['path', 'content'],
						properties: {
							path: { type: 'string' },
							content: { type: 'string' },
						},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'create_folder',
					description: 'Create folder by path.',
					parameters: {
						type: 'object',
						required: ['path'],
						properties: {
							path: { type: 'string' },
						},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'rename_path',
					description: 'Rename or move file/folder.',
					parameters: {
						type: 'object',
						required: ['oldPath', 'newPath'],
						properties: {
							oldPath: { type: 'string' },
							newPath: { type: 'string' },
						},
					},
				},
			},
		];
	}

	private async executeAgentTool(
		toolName: string,
		rawArguments: string
	): Promise<{ result: string; undoOperation?: AgentUndoOperation }> {
		let args: Record<string, unknown> = {};
		if (rawArguments.trim()) {
			try {
				args = JSON.parse(rawArguments) as Record<string, unknown>;
			} catch {
				throw new Error(`Invalid tool arguments for ${toolName}`);
			}
		}

		if (this.requiresWriteConfirmation(toolName) && this.plugin.settings.requireWriteConfirmation) {
			const approved = await this.confirmWriteAction(toolName, args);
			if (!approved) {
				return { result: `Cancelled by user: ${toolName}` };
			}
		}

		switch (toolName) {
			case 'list_files': {
				const limit = typeof args.limit === 'number' ? args.limit : 200;
				return { result: this.vaultAgentService.listFiles(limit) };
			}
			case 'read_file': {
				const path = this.getStringArg(args, 'path');
				return { result: await this.vaultAgentService.readFile(path) };
			}
			case 'write_file': {
				const path = this.getStringArg(args, 'path');
				const content = this.getStringArg(args, 'content');

				const previousContent = await this.vaultAgentService.readFileIfExists(path);
				const result = await this.vaultAgentService.writeFile(path, content);
				const undoOperation: AgentUndoOperation = previousContent === null
					? { type: 'delete_path', path }
					: { type: 'restore_file', path, content: previousContent };

				return { result, undoOperation };
			}
			case 'append_file': {
				const path = this.getStringArg(args, 'path');
				const content = this.getStringArg(args, 'content');
				const previousContent = await this.vaultAgentService.readFileIfExists(path);
				const result = await this.vaultAgentService.appendFile(path, content);
				if (previousContent === null) {
					return { result };
				}

				return {
					result,
					undoOperation: {
						type: 'restore_file',
						path,
						content: previousContent,
					},
				};
			}
			case 'create_folder': {
				const path = this.getStringArg(args, 'path');
				const existed = this.vaultAgentService.getAbstractPath(path) !== null;
				const result = await this.vaultAgentService.createFolder(path);
				if (existed) {
					return { result };
				}

				return {
					result,
					undoOperation: { type: 'delete_path', path },
				};
			}
			case 'rename_path': {
				const oldPath = this.getStringArg(args, 'oldPath');
				const newPath = this.getStringArg(args, 'newPath');
				const result = await this.vaultAgentService.renamePath(oldPath, newPath);
				return {
					result,
					undoOperation: {
						type: 'rename_path',
						oldPath: newPath,
						newPath: oldPath,
					},
				};
			}
			default:
				throw new Error(`Unsupported tool: ${toolName}`);
		}
	}

	private requiresWriteConfirmation(toolName: string): boolean {
		return toolName === 'write_file'
			|| toolName === 'append_file'
			|| toolName === 'create_folder'
			|| toolName === 'rename_path';
	}

	private async confirmWriteAction(toolName: string, args: Record<string, unknown>): Promise<boolean> {
		return await new Promise<boolean>((resolve) => {
			const modal = new AgentWriteConfirmModal(
				this.app,
				toolName,
				JSON.stringify(args, null, 2),
				resolve,
			);
			modal.open();
		});
	}

	private getStringArg(args: Record<string, unknown>, key: string): string {
		const value = args[key];
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Missing required argument: ${key}`);
		}

		return value;
	}

	private async copyMessageContent(content: string): Promise<void> {
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				await navigator.clipboard.writeText(content);
				new Notice('Message copied.');
				return;
			}

			new Notice('Clipboard access unavailable. Select text and copy manually.');
		} catch {
			new Notice('Copy failed. Select text and copy manually.');
		}
	}

	private async revertAgentOperations(
		conversationId: string,
		messageId: string,
		operations: AgentUndoOperation[]
	): Promise<void> {
		if (operations.length === 0) {
			new Notice('No operations to revert.');
			return;
		}

		try {
			for (let index = operations.length - 1; index >= 0; index--) {
				const operation = operations[index];
				if (!operation) continue;

				if (operation.type === 'restore_file') {
					await this.vaultAgentService.writeFile(operation.path, operation.content);
					continue;
				}

				if (operation.type === 'delete_path') {
					await this.vaultAgentService.deletePath(operation.path);
					continue;
				}

				if (operation.type === 'rename_path') {
					await this.vaultAgentService.renamePath(operation.oldPath, operation.newPath);
				}
			}

			this.chatManager.setMessageUndoState(conversationId, messageId, 'applied');
			await this.renderMessages();
			void this.plugin.saveChatHistory();
			new Notice('Agent operations reverted.');
		} catch (error) {
			this.chatManager.setMessageUndoState(conversationId, messageId, 'failed');
			await this.renderMessages();
			void this.plugin.saveChatHistory();
			const message = error instanceof Error ? error.message : 'Unknown revert error';
			new Notice(`Revert failed: ${message}`);
		}
	}

	async onClose() {
		// Cleanup
	}
}

class AgentWriteConfirmModal extends Modal {
	private toolName: string;
	private argsPreview: string;
	private resolver: (approved: boolean) => void;
	private resolved: boolean;

	constructor(app: AgentPlugin['app'], toolName: string, argsPreview: string, resolver: (approved: boolean) => void) {
		super(app);
		this.toolName = toolName;
		this.argsPreview = argsPreview;
		this.resolver = resolver;
		this.resolved = false;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Confirm write action' });
		contentEl.createEl('p', { text: `Agent requested tool: ${this.toolName}` });

		const previewEl = contentEl.createEl('pre', { cls: 'agent-write-confirm-preview' });
		previewEl.setText(this.argsPreview);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('Allow')
					.setCta()
					.onClick(() => {
						this.resolveOnce(true);
						this.close();
					})
			)
			.addButton((button) =>
				button
					.setButtonText('Cancel')
					.onClick(() => {
						this.resolveOnce(false);
						this.close();
					})
			);
	}

	onClose(): void {
		this.resolveOnce(false);
		this.contentEl.empty();
	}

	private resolveOnce(value: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolver(value);
	}
}

import { ButtonComponent, ItemView, MarkdownRenderer, MarkdownView, Notice, TextAreaComponent, WorkspaceLeaf } from 'obsidian';
import AgentPlugin from '../main';
import { ChatManager } from '../models/ChatManager';
import { AgentUndoOperation, Conversation } from '../models/types';
import { AgentMessage } from '../services/LLMService';
import { VaultAgentService } from '../services/VaultAgentService';
import { AgentToolExecutor } from '../services/agent/AgentToolExecutor';
import { AgentToolRegistry } from '../services/agent/AgentToolRegistry';
import { AgentRunMode, getAgentRunModeLabel, getNextAgentRunMode } from '../services/agent/types';

export const VIEW_TYPE_CHAT = 'agent-chat-view';

export class ChatView extends ItemView {
	plugin: AgentPlugin;
	chatManager: ChatManager;
	vaultAgentService: VaultAgentService;
	toolRegistry: AgentToolRegistry;
	toolExecutor: AgentToolExecutor;
	conversationListEl: HTMLElement;
	contextListEl: HTMLElement;
	chatContainer: HTMLElement;
	inputComponent: TextAreaComponent;
	agentMode: AgentRunMode;

	constructor(leaf: WorkspaceLeaf, plugin: AgentPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.chatManager = plugin.chatManager;
		this.vaultAgentService = new VaultAgentService(plugin.app);
		this.toolRegistry = new AgentToolRegistry();
		this.toolExecutor = new AgentToolExecutor(plugin.app, this.vaultAgentService, this.toolRegistry);
		this.agentMode = plugin.settings.defaultMode;
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
		agentModeButton.setButtonText(this.getModeButtonLabel()).onClick(() => {
			this.agentMode = getNextAgentRunMode(this.agentMode);
			this.plugin.settings.defaultMode = this.agentMode;
			agentModeButton.setButtonText(this.getModeButtonLabel());
			void this.plugin.saveSettings();
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

		await this.plugin.syncActiveFileToConversationContext();

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

		await this.plugin.syncActiveFileToConversationContext();

		this.chatManager.addMessage(conversation.id, 'user', content);
		void this.plugin.saveChatHistory();
		this.renderConversationList();
		await this.renderMessages();

		if (this.agentMode === 'chat') {
			await this.generateResponse();
		} else {
			await this.generateAgentResponse(this.agentMode);
		}
	}

	async generateAgentResponse(mode: Exclude<AgentRunMode, 'chat'> = 'act') {
		const conversation = this.chatManager.getActiveConversation();
		if (!conversation) return;

		const loadingLabel = mode === 'plan' ? 'Agent is drafting a plan...' : 'Agent is working...';
		const loadingMsg = this.chatManager.addMessage(conversation.id, 'assistant', loadingLabel);
		await this.renderMessages();

		try {
			const undoOperations: AgentUndoOperation[] = [];
			const promptMessages: AgentMessage[] = [];
			if (this.plugin.settings.systemPrompt.trim()) {
				promptMessages.push({
					role: 'system',
					content: this.plugin.settings.systemPrompt,
				});
			}

			promptMessages.push({
				role: 'system',
				content: this.getAgentModePrompt(mode),
			});

			const contextPrompt = this.buildContextPrompt(conversation.id);
			if (contextPrompt) {
				promptMessages.push({ role: 'system', content: contextPrompt });
			}

			const workingMessages: AgentMessage[] = conversation.messages
				.filter((message) => message.id !== loadingMsg.id)
				.map((message) => ({ role: message.role, content: message.content }));
			workingMessages.unshift(...promptMessages.reverse());

			const tools = this.toolRegistry.getTools(mode);
			let finalAnswer = '';
			const implicitTargetPath = this.getImplicitTargetPath(conversation);

			for (let step = 0; step < this.plugin.settings.maxAgentSteps; step++) {
				const response = await this.plugin.llmService.generateAgentResponse(workingMessages, tools);

				if (response.toolCalls.length === 0) {
					finalAnswer = response.content || (mode === 'plan' ? 'Plan complete.' : 'Done.');
					break;
				}

				workingMessages.push({
					role: 'assistant',
					content: response.content,
					toolCalls: response.toolCalls,
				});

				for (const toolCall of response.toolCalls) {
					const execution = await this.toolExecutor.executeTool(toolCall.name, toolCall.arguments, {
						implicitTargetPath,
						requireWriteConfirmation: this.plugin.settings.requireWriteConfirmation && mode === 'act',
					});
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
				finalAnswer = mode === 'plan'
					? 'Planning finished. Review the proposed steps and switch to act mode when you want execution.'
					: 'Agent finished tool calls. Please ask me to summarize results if needed.';
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

	private getModeButtonLabel(): string {
		return `Mode: ${getAgentRunModeLabel(this.agentMode)}`;
	}

	private getAgentModePrompt(mode: Exclude<AgentRunMode, 'chat'>): string {
		if (mode === 'plan') {
			return 'You are an Obsidian vault planning agent. Use only read-only tools to inspect the vault. Produce a concise execution plan, note assumptions, and do not attempt write operations.';
		}

		return 'You are an Obsidian vault action agent. Use tools when file operations are required. Keep operations precise, minimal, and aligned with the user request.';
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

			const clearHistoryButton = new ButtonComponent(row);
			clearHistoryButton.setClass('agent-conversation-clear-btn');
			clearHistoryButton.setIcon('eraser');
			clearHistoryButton.setTooltip('Clear conversation history');
			clearHistoryButton.onClick(() => {
				this.chatManager.clearConversationHistory(conversation.id);
				void this.plugin.saveChatHistory();
				this.renderConversationList();
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

		const manualItems = conversation.contextItems.filter((item) => !item.isAutoActiveFile);
		const autoItems = conversation.contextItems.filter((item) => item.isAutoActiveFile);
		const orderedItems = [...manualItems, ...autoItems];

		const manualTargetPath = [...manualItems]
			.reverse()
			.find((item) => item.sourcePath)?.sourcePath;

		const blocks = orderedItems.map((item, index) => {
			const header = item.type === 'file' ? `File context ${index + 1}` : `Selection context ${index + 1}`;
			const sourceTag = item.isAutoActiveFile ? ' (auto)' : ' (manual)';
			const source = item.sourcePath ? `Source${sourceTag}: ${item.sourcePath}` : `Source${sourceTag}: unknown`;
			return `${header}\n${source}\n\n\`\`\`\n${item.content}\n\`\`\``;
		});

		const priorityRule = manualItems.length > 0
			? 'Manual context is authoritative. If manual and auto context conflict, follow manual context first.'
			: 'Use attached context as primary reference.';

		const targetRule = manualTargetPath
			? `When user says "this document" or equivalent, treat this as the target file path: ${manualTargetPath}`
			: 'When user says "this document", prefer the context source path that best matches user intent.';

		return `You are given attached context from the user vault.\n${priorityRule}\n${targetRule}\nIf the question needs data not present in context, say what is missing.\n\n${blocks.join('\n\n---\n\n')}`;
	}

	private getImplicitTargetPath(conversation: Conversation): string | null {
		const latestUserMessage = [...conversation.messages]
			.reverse()
			.find((message) => message.role === 'user')?.content ?? '';

		const refersCurrentDocument = /(this document|this doc|this note|current document|当前文档|这个文档|该文档|这个笔记|当前笔记)/i.test(latestUserMessage);
		if (!refersCurrentDocument) {
			return null;
		}

		const latestManualSourcePath = [...conversation.contextItems]
			.reverse()
			.find((item) => !item.isAutoActiveFile && item.sourcePath)?.sourcePath;
		if (latestManualSourcePath) {
			return latestManualSourcePath;
		}

		const latestAutoSourcePath = [...conversation.contextItems]
			.reverse()
			.find((item) => item.isAutoActiveFile && item.sourcePath)?.sourcePath;

		return latestAutoSourcePath ?? null;
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

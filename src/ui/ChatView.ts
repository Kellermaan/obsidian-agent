import { ButtonComponent, ItemView, MarkdownRenderer, MarkdownView, Notice, TextAreaComponent, WorkspaceLeaf } from 'obsidian';
import AgentPlugin from '../main';
import { ChatManager } from '../models/ChatManager';

export const VIEW_TYPE_CHAT = 'agent-chat-view';

export class ChatView extends ItemView {
	plugin: AgentPlugin;
	chatManager: ChatManager;
	conversationListEl: HTMLElement;
	contextListEl: HTMLElement;
	chatContainer: HTMLElement;
	inputComponent: TextAreaComponent;

	constructor(leaf: WorkspaceLeaf, plugin: AgentPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.chatManager = plugin.chatManager;
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

		await this.generateResponse();
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
			msgDiv.createDiv({ cls: 'agent-message-role', text: msg.role === 'user' ? 'You' : 'Agent' });
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

	async onClose() {
		// Cleanup
	}
}

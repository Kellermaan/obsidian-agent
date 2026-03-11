import { ButtonComponent, ItemView, MarkdownRenderer, Notice, TextAreaComponent, WorkspaceLeaf } from 'obsidian';
import AgentPlugin from '../main';
import { ChatManager } from '../models/ChatManager';

export const VIEW_TYPE_CHAT = 'agent-chat-view';

export class ChatView extends ItemView {
	plugin: AgentPlugin;
	chatManager: ChatManager;
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
		const newChatBtn = new ButtonComponent(header);
		newChatBtn.setIcon('plus').setTooltip('New chat').onClick(() => {
			this.chatManager.createConversation();
			void this.renderMessages();
		});

		this.chatContainer = container.createDiv({ cls: 'agent-messages' });
		
		const inputContainer = container.createDiv({ cls: 'agent-input-area' });
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

		void this.renderMessages();
	}

	async handleSend() {
		const content = this.inputComponent.getValue();
		if (!content.trim()) return;

		this.inputComponent.setValue('');
		
		let conversation = this.chatManager.getActiveConversation();
		if (!conversation) {
			conversation = this.chatManager.createConversation();
		}

		this.chatManager.addMessage(conversation.id, 'user', content);
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

			await this.plugin.llmService.streamResponse(
				history,
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
		if (!conversation) return;

		for (const msg of conversation.messages) {
			const msgDiv = this.chatContainer.createDiv({ cls: `agent-message ${msg.role}` });
			msgDiv.createDiv({ cls: 'agent-message-role', text: msg.role === 'user' ? 'You' : 'Agent' });
			const contentDiv = msgDiv.createDiv({ cls: 'agent-message-content' });
			
			await MarkdownRenderer.render(this.plugin.app, msg.content, contentDiv, '', this);
		}
		
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	async onClose() {
		// Cleanup
	}
}

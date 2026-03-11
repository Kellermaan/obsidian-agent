import { Editor, MarkdownView, Menu, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { AgentSettings, DEFAULT_SETTINGS } from './settings/settings';
import { AgentSettingTab } from './settings/SettingsTab';
import { ChatManager } from './models/ChatManager';
import { ChatState } from './models/types';
import { LLMProviderService } from './services/LLMProviderService';
import { ChatView, VIEW_TYPE_CHAT } from './ui/ChatView';

interface AgentData {
	settings: AgentSettings;
	chatHistory: ChatState;
}

export default class AgentPlugin extends Plugin {
	settings: AgentSettings;
	chatManager: ChatManager;
	llmService: LLMProviderService;

	async onload() {
		await this.loadDataAndSettings();

		this.llmService = new LLMProviderService(this.settings);
		
		this.registerView(
			VIEW_TYPE_CHAT,
			(leaf) => new ChatView(leaf, this)
		);

		this.addRibbonIcon('bot', 'Agent chat', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-agent-chat',
			name: 'Open chat',
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: 'explain-selection',
			name: 'Explain selection',
			editorCallback: (editor: Editor) => {
				const selection = editor.getSelection();
				if (selection) {
					void this.activateView().then((leaf) => {
						const conversation = this.chatManager.getActiveConversation() || this.chatManager.createConversation();
						this.chatManager.setActiveConversation(conversation.id);
						this.chatManager.addMessage(conversation.id, 'user', `Explain this:\n\n${selection}`);
						
						if (leaf) {
							const view = leaf.view;
							if (view instanceof ChatView) {
								void view.renderMessages().then(() => {
									void view.generateResponse();
								});
							}
						}
					});
				} else {
					new Notice('No text selected');
				}
			}
		});

		this.addCommand({
			id: 'add-note-to-agent-context',
			name: 'Add current note to agent context',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}

				if (!checking) {
					void this.addFileContextToActiveConversation(view.file);
				}

				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file) => {
				if (!(file instanceof TFile)) return;

				menu.addItem((item) => {
					item
						.setTitle('Add note to agent context')
						.setIcon('bot')
						.onClick(() => {
							void this.addFileContextToActiveConversation(file);
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				const selectedText = editor.getSelection().trim();
				if (!selectedText) return;

				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file = markdownView?.file;

				menu.addItem((item) => {
					item
						.setTitle('Add selection to agent context')
						.setIcon('whole-word')
						.onClick(() => {
							void this.addSelectionContextToActiveConversation(selectedText, file ?? undefined);
						});
				});
			})
		);

		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				void this.syncActiveFileToConversationContext();
			})
		);

		this.addSettingTab(new AgentSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup
	}

	async loadDataAndSettings() {
		const data = (await this.loadData()) as Partial<AgentData> | null;
		
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
		
		this.chatManager = new ChatManager();
		if (data?.chatHistory) {
			this.chatManager.loadState(data.chatHistory);
		}
	}

	async saveSettings() {
		await this.saveData({
			settings: this.settings,
			chatHistory: this.chatManager.getState()
		});
		if (this.llmService) {
			this.llmService.updateSettings(this.settings);
		}
	}
	
	async saveChatHistory() {
		await this.saveSettings();
	}

	async activateView(): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			leaf = leaves[0] ?? null;
		} else {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
		}
		return leaf;
	}

	async addFileContextToActiveConversation(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const conversation = this.chatManager.getActiveConversation() ?? this.chatManager.createConversation('New chat');

		this.chatManager.addContextItem(conversation.id, {
			type: 'file',
			label: file.path,
			sourcePath: file.path,
			content: this.clipContext(content),
		});

		await this.saveChatHistory();
		await this.refreshOpenChatView();
		new Notice('Note added to agent context.');
	}

	async addSelectionContextToActiveConversation(selection: string, file?: TFile): Promise<void> {
		const normalizedSelection = selection.trim();
		if (!normalizedSelection) {
			new Notice('Select text first to add selection context.');
			return;
		}

		const conversation = this.chatManager.getActiveConversation() ?? this.chatManager.createConversation('New chat');
		const label = file ? `${file.path} (selection)` : 'Selection';

		this.chatManager.addContextItem(conversation.id, {
			type: 'selection',
			label,
			sourcePath: file?.path,
			content: this.clipContext(normalizedSelection),
		});

		await this.saveChatHistory();
		await this.refreshOpenChatView();
		new Notice('Selection added to agent context.');
	}

	async syncActiveFileToConversationContext(): Promise<void> {
		const conversation = this.chatManager.getActiveConversation();
		if (!conversation) return;

		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.file) {
			const removed = this.chatManager.removeAutoActiveFileContext(conversation.id);
			if (removed) {
				await this.saveChatHistory();
				await this.refreshOpenChatView();
			}
			return;
		}

		const content = await this.app.vault.cachedRead(markdownView.file);
		const changed = this.chatManager.upsertAutoActiveFileContext(conversation.id, {
			type: 'file',
			label: `Active: ${markdownView.file.path}`,
			sourcePath: markdownView.file.path,
			content: this.clipContext(content),
			isAutoActiveFile: true,
		});

		if (changed) {
			await this.saveChatHistory();
			await this.refreshOpenChatView();
		}
	}

	private clipContext(content: string): string {
		const maxChars = 6000;
		if (content.length <= maxChars) {
			return content;
		}

		return `${content.slice(0, maxChars)}\n\n[Context truncated]`;
	}

	private async refreshOpenChatView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof ChatView) {
				view.renderConversationList();
				view.renderContextItems();
				await view.renderMessages();
			}
		}
	}
}

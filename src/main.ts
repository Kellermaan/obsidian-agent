import { Editor, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { AgentSettings, DEFAULT_SETTINGS } from './settings/settings';
import { AgentSettingTab } from './settings/SettingsTab';
import { ChatManager } from './models/ChatManager';
import { ChatState } from './models/types';
import { OpenAIService } from './services/OpenAIService';
import { ChatView, VIEW_TYPE_CHAT } from './ui/ChatView';

interface AgentData {
	settings: AgentSettings;
	chatHistory: ChatState;
}

export default class AgentPlugin extends Plugin {
	settings: AgentSettings;
	chatManager: ChatManager;
	llmService: OpenAIService;

	async onload() {
		await this.loadDataAndSettings();

		this.llmService = new OpenAIService(this.settings);
		
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
}

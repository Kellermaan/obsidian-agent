import { Plugin, WorkspaceLeaf } from 'obsidian';
import { AgentPluginSettings, AgentSettingTab, DEFAULT_SETTINGS } from './settings';
import { ChatView, CHAT_VIEW_TYPE } from './ui/ChatView';

export default class AgentPlugin extends Plugin {
	settings!: AgentPluginSettings;

// Register the chat panel view
this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

		// Register the sidebar chat view
		this.registerView(CHAT_VIEW_TYPE, leaf => new ChatView(leaf, this));

		// Ribbon icon
		this.addRibbonIcon('bot', 'Open AI agent', () => {
			void this.activateChatView();
		});

		// Command palette entry
		this.addCommand({
			id: 'open-agent-chat',
			name: 'Open chat',
			callback: () => {
				void this.activateChatView();
			},
		});

		// Settings tab
		this.addSettingTab(new AgentSettingTab(this.app, this));
	}

	onunload() {
		// Leaves are cleaned up automatically when the plugin is disabled
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<AgentPluginSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateChatView() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

		let leaf: WorkspaceLeaf;
		if (existing.length > 0) {
			leaf = existing[0]!;
		} else {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		}

		await workspace.revealLeaf(leaf);
	}
}


import { Editor, MarkdownView, Plugin, WorkspaceLeaf } from 'obsidian';
import { AgentPluginSettings, AgentSettingTab, DEFAULT_SETTINGS } from './settings';
import { ChatView, CHAT_VIEW_TYPE } from './ui/ChatView';

export default class AgentPlugin extends Plugin {
	settings!: AgentPluginSettings;

	async onload() {
		await this.loadSettings();

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

		// Add selected editor text as context in the chat input
		this.addCommand({
			id: 'add-selection-to-chat',
			name: 'Add selected text to chat context',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (!selectedText) {
					return;
				}
				const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
				if (leaves.length === 0) {
					void this.activateChatView().then(() => {
						const newLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
						if (newLeaves.length > 0) {
							(newLeaves[0]!.view as ChatView).addSelectionToContext(
								selectedText,
								view.file?.path ?? '',
							);
						}
					});
				} else {
					(leaves[0]!.view as ChatView).addSelectionToContext(
						selectedText,
						view.file?.path ?? '',
					);
					void this.activateChatView();
				}
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


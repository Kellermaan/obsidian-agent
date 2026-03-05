import { Plugin } from 'obsidian';
import { AgentPluginSettings, DEFAULT_SETTINGS, AgentSettingTab } from './settings';
import { ChatView, CHAT_VIEW_TYPE } from './ui/chat-view';

export default class AgentPlugin extends Plugin {
settings: AgentPluginSettings;

async onload(): Promise<void> {
await this.loadSettings();

// Register the chat panel view
this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

// Ribbon icon – opens the agent chat panel
this.addRibbonIcon('bot', 'Open agent chat', () => {
void this.activateView();
});

// Commands
this.addCommand({
id: 'open-agent-chat',
name: 'Open agent chat',
callback: () => { void this.activateView(); },
});

this.addCommand({
id: 'ask-about-current-note',
name: 'Ask agent about current note',
callback: () => { void this.activateView(); },
});

// Settings tab
this.addSettingTab(new AgentSettingTab(this.app, this));
}

onunload(): void {
// Nothing to do — Obsidian cleans up registered views automatically.
}

async loadSettings(): Promise<void> {
this.settings = Object.assign(
{},
DEFAULT_SETTINGS,
await this.loadData() as Partial<AgentPluginSettings>,
);
}

async saveSettings(): Promise<void> {
await this.saveData(this.settings);
// Propagate updated settings to any open chat views
for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
(leaf.view as ChatView).updateAgent();
}
}

async activateView(): Promise<void> {
const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
const first = existing[0];
if (first) {
await this.app.workspace.revealLeaf(first);
return;
}
const leaf = this.app.workspace.getRightLeaf(false);
if (leaf) {
await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
await this.app.workspace.revealLeaf(leaf);
}
}
}

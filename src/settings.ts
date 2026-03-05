import { App, PluginSettingTab, Setting } from 'obsidian';
import AgentPlugin from './main';

export interface AgentPluginSettings {
	apiUrl: string;
	apiKey: string;
	model: string;
	maxTokens: number;
	temperature: number;
	systemPrompt: string;
	autoApplyEdits: boolean;
	streamResponse: boolean;
}

export const DEFAULT_SETTINGS: AgentPluginSettings = {
	apiUrl: 'https://api.openai.com/v1',
	apiKey: '',
	model: 'gpt-4o',
	maxTokens: 4096,
	temperature: 0.7,
	systemPrompt: `You are a helpful AI assistant integrated into Obsidian, a note-taking app.
You can help users write, edit, search, and organize their notes.
When asked to modify notes, use the provided tools to read the current content first, then apply precise edits.
Always be concise and accurate. Prefer patch_note for targeted edits and write_note for full rewrites.`,
	autoApplyEdits: false,
	streamResponse: true,
};

export class AgentSettingTab extends PluginSettingTab {
	plugin: AgentPlugin;

	constructor(app: App, plugin: AgentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API URL')
			.setDesc('OpenAI-compatible API base URL, e.g. https://api.openai.com/v1 or a local endpoint')
			.addText(text =>
				text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.plugin.settings.apiUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your API key (stored locally, never shared)')
			.addText(text => {
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				return text;
			});

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Model to use for chat completions (gpt-4o, gpt-4-turbo, claude-3-5-sonnet-20241022, local models, etc.)')
			.addText(text =>
				text
					.setPlaceholder('Enter model name')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max tokens')
			.setDesc('Maximum tokens in the response (256 – 8192)')
			.addSlider(slider =>
				slider
					.setLimits(256, 8192, 256)
					.setValue(this.plugin.settings.maxTokens)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxTokens = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Randomness of responses (0 = deterministic, 1 = creative)')
			.addSlider(slider =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc('Instructions sent to the AI at the start of every conversation')
			.addTextArea(text => {
				text
					.setPlaceholder('You are a helpful assistant...')
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 6;
				text.inputEl.classList.add('agent-settings-textarea');
				return text;
			});

		new Setting(containerEl)
			.setName('Auto-apply edits')
			.setDesc('Automatically apply note edits without showing a confirmation dialog')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.autoApplyEdits)
					.onChange(async (value) => {
						this.plugin.settings.autoApplyEdits = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Stream responses')
			.setDesc('Show AI responses word-by-word as they are generated')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.streamResponse)
					.onChange(async (value) => {
						this.plugin.settings.streamResponse = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

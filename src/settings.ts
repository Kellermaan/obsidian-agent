import { App, PluginSettingTab, Setting } from 'obsidian';
import AgentPlugin from './main';

export interface AgentPluginSettings {
	apiUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	maxTokens: number;
	temperature: number;
	autoApplyEdits: boolean;
}

export const DEFAULT_SETTINGS: AgentPluginSettings = {
	apiUrl: 'https://api.openai.com/v1',
	apiKey: '',
	model: 'gpt-4o',
	systemPrompt:
		'You are a helpful AI assistant integrated into Obsidian, a personal knowledge management app. ' +
		'You can help users write, edit, search, and organize their notes. ' +
		'When the user asks you to edit or create notes, use the provided tools. ' +
		'Prefer making targeted, minimal changes rather than rewriting entire documents unless explicitly asked.',
	maxTokens: 4096,
	temperature: 0.7,
	autoApplyEdits: false,
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
			.setDesc('OpenAI-compatible API endpoint (e.g. https://api.openai.com/v1 or a local Ollama address)')
			.addText(text =>
				text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.plugin.settings.apiUrl)
					.onChange(async value => {
						this.plugin.settings.apiUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your API key for the AI service (leave empty for local models)')
			.addText(text => {
				text
					.setPlaceholder('Paste your API key here')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async value => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
				return text;
			});

		new Setting(containerEl)
			.setName('Model')
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc('The AI model to use (e.g. gpt-4o, claude-3-5-sonnet-20241022, deepseek-chat, llama3)')
			.addText(text =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder('gpt-4o')
					.setValue(this.plugin.settings.model)
					.onChange(async value => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max tokens')
			.setDesc('Maximum number of tokens in the AI response')
			.addText(text =>
				text
					.setPlaceholder('4096')
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async value => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxTokens = num;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness: 0 = deterministic, 1 = more creative')
			.addSlider(slider =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async value => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Auto-apply note edits')
			.setDesc(
				'When enabled, the AI will apply note edits immediately without asking for confirmation. ' +
					'When disabled, each proposed edit shows a diff with Apply / Reject buttons.'
			)
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.autoApplyEdits).onChange(async value => {
					this.plugin.settings.autoApplyEdits = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc('Custom instructions sent to the AI at the start of every conversation')
			.addTextArea(text => {
				text
					.setPlaceholder('You are a helpful assistant...')
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async value => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 6;
				text.inputEl.addClass('agent-settings-textarea');
				return text;
			});
	}
}

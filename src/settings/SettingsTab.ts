import { App, PluginSettingTab, Setting } from 'obsidian';
import AgentPlugin from '../main';
import { AgentSettings } from './settings';

function isAgentProvider(value: string): value is AgentSettings['provider'] {
	return value === 'openai' || value === 'anthropic' || value === 'custom';
}

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
			.setName('Provider')
			.setDesc('Select the AI provider.')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'Openai service')
				.addOption('custom', 'Custom openai-compatible service')
				.setValue(this.plugin.settings.provider)
				.onChange(async (value) => {
					if (isAgentProvider(value)) {
						this.plugin.settings.provider = value;
					}
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide fields
				}));

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Enter your API key.')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Enter the model name (e.g., gpt-4, gpt-3.5-turbo).')
			.addText(text => text
				.setPlaceholder('Enter model name')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));
		
		if (this.plugin.settings.provider === 'custom') {
			new Setting(containerEl)
				.setName('Base URL')
				.setDesc('Enter the base URL for the API.')
				.addText(text => text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.plugin.settings.baseUrl || '')
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('System prompt')
			.setDesc('The system prompt for the AI.')
			.addTextArea(text => text
				.setPlaceholder('You are a helpful assistant...')
				.setValue(this.plugin.settings.systemPrompt)
				.onChange(async (value) => {
					this.plugin.settings.systemPrompt = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0-1).')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.1)
				.setValue(this.plugin.settings.temperature)
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Max tokens')
			.setDesc('Maximum number of tokens to generate.')
			.addText(text => text
				.setPlaceholder('1000')
				.setValue(String(this.plugin.settings.maxTokens))
				.onChange(async (value) => {
					const parsedValue = Number.parseInt(value, 10);
					if (!Number.isNaN(parsedValue)) {
						this.plugin.settings.maxTokens = parsedValue;
					}
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Require confirmation before write actions')
			.setDesc('Ask for confirmation before the agent writes, appends, renames, or creates folders.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.requireWriteConfirmation)
					.onChange(async (value) => {
						this.plugin.settings.requireWriteConfirmation = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

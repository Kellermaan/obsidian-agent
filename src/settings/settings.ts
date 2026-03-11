export interface AgentSettings {
	provider: 'openai' | 'anthropic' | 'custom';
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
	requireWriteConfirmation: boolean;
	baseUrl?: string;
}

export const DEFAULT_SETTINGS: AgentSettings = {
	provider: 'openai',
	apiKey: '',
	model: 'gpt-3.5-turbo',
	temperature: 0.7,
	maxTokens: 1000,
	systemPrompt: 'You are a helpful AI assistant integrated into Obsidian. You help the user with writing, coding, and organizing knowledge.',
	requireWriteConfirmation: true,
	baseUrl: 'https://api.openai.com/v1'
};

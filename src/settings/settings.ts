import { AgentRunMode } from '../services/agent/types';

export interface AgentSettings {
	provider: 'openai' | 'anthropic' | 'custom' | 'custom-anthropic';
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	defaultMode: AgentRunMode;
	maxAgentSteps: number;
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
	defaultMode: 'chat',
	maxAgentSteps: 6,
	systemPrompt: 'You are a helpful AI assistant integrated into Obsidian. You help the user with writing, coding, and organizing knowledge.',
	requireWriteConfirmation: true,
	baseUrl: 'https://api.openai.com/v1'
};

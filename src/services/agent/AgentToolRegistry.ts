import { AgentToolDefinition } from '../LLMService';
import { AgentRunMode } from './types';

export const READ_ONLY_AGENT_TOOLS = new Set<string>(['list_files', 'read_file']);

const AGENT_TOOLS: AgentToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'list_files',
			description: 'List markdown files in the vault.',
			parameters: {
				type: 'object',
				properties: {
					limit: { type: 'number' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read file content by path.',
			parameters: {
				type: 'object',
				required: ['path'],
				properties: {
					path: { type: 'string' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description: 'Create or overwrite file content.',
			parameters: {
				type: 'object',
				required: ['path', 'content'],
				properties: {
					path: { type: 'string' },
					content: { type: 'string' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'append_file',
			description: 'Append content to existing file.',
			parameters: {
				type: 'object',
				required: ['path', 'content'],
				properties: {
					path: { type: 'string' },
					content: { type: 'string' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'create_folder',
			description: 'Create folder by path.',
			parameters: {
				type: 'object',
				required: ['path'],
				properties: {
					path: { type: 'string' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'rename_path',
			description: 'Rename or move file/folder.',
			parameters: {
				type: 'object',
				required: ['oldPath', 'newPath'],
				properties: {
					oldPath: { type: 'string' },
					newPath: { type: 'string' },
				},
			},
		},
	},
];

export class AgentToolRegistry {
	getTools(mode: Exclude<AgentRunMode, 'chat'>): AgentToolDefinition[] {
		if (mode === 'plan') {
			return AGENT_TOOLS.filter((tool) => READ_ONLY_AGENT_TOOLS.has(tool.function.name));
		}

		return AGENT_TOOLS;
	}

	isWriteTool(toolName: string): boolean {
		return !READ_ONLY_AGENT_TOOLS.has(toolName);
	}
}

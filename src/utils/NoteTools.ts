import { App, TFile } from 'obsidian';
import { ToolDefinition } from '../types';

const MAX_SEARCH_RESULTS = 20;
const MAX_MATCHING_LINES = 3;

export const NOTE_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'read_note',
			description: 'Read the full content of a note in the Obsidian vault by its path.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Vault-relative path to the note, including the .md extension (e.g. "folder/My Note.md").',
					},
				},
				required: ['path'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'write_note',
			description:
				'Write (create or overwrite) a note in the Obsidian vault. ' +
				'The entire file content is replaced with the provided text. ' +
				'If the note does not exist it will be created.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Vault-relative path to the note, including the .md extension.',
					},
					content: {
						type: 'string',
						description: 'Full markdown content to write to the note.',
					},
				},
				required: ['path', 'content'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'list_notes',
			description: 'List all markdown notes in a vault directory (or the entire vault if no directory is given).',
			parameters: {
				type: 'object',
				properties: {
					directory: {
						type: 'string',
						description: 'Optional vault-relative directory path (e.g. "Projects"). Defaults to the vault root.',
					},
				},
				required: [],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'search_notes',
			description: 'Search all notes for those containing a given text query. Returns matching file paths and up to 3 matching lines per file.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The text to search for (case-insensitive).',
					},
				},
				required: ['query'],
			},
		},
	},
];

export class NoteToolsHandler {
	constructor(private app: App) {}

	async handleToolCall(name: string, args: Record<string, string>): Promise<string> {
		switch (name) {
			case 'read_note':
				return this.readNote(args['path'] ?? '');
			case 'write_note':
				return this.writeNote(args['path'] ?? '', args['content'] ?? '');
			case 'list_notes':
				return this.listNotes(args['directory']);
			case 'search_notes':
				return this.searchNotes(args['query'] ?? '');
			default:
				return `Unknown tool: ${name}`;
		}
	}

	async readNote(path: string): Promise<string> {
		const normalizedPath = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(file instanceof TFile)) {
			// If the caller omitted the .md extension, try appending it
			if (!normalizedPath.endsWith('.md')) {
				const withExt = normalizePath(`${normalizedPath}.md`);
				const file2 = this.app.vault.getAbstractFileByPath(withExt);
				if (file2 instanceof TFile) return this.app.vault.read(file2);
			}
			return `Error: Note not found at "${path}". Use list_notes to find the correct path.`;
		}
		return this.app.vault.read(file);
	}

	async writeNote(path: string, content: string): Promise<string> {
		const normalizedPath = normalizePath(path.endsWith('.md') ? path : `${path}.md`);
		try {
			const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, content);
				return `Updated note: ${normalizedPath}`;
			}
			// Ensure parent directories exist
			const parts = normalizedPath.split('/');
			if (parts.length > 1) {
				const dir = parts.slice(0, -1).join('/');
				await this.ensureDir(dir);
			}
			await this.app.vault.create(normalizedPath, content);
			return `Created note: ${normalizedPath}`;
		} catch (err) {
			return `Error writing note: ${String(err)}`;
		}
	}

	async listNotes(directory?: string): Promise<string> {
		const files = this.app.vault.getMarkdownFiles();
		let filtered = files;
		if (directory) {
			const prefix = directory.endsWith('/') ? directory : `${directory}/`;
			filtered = files.filter(f => f.path.startsWith(prefix));
		}
		if (filtered.length === 0) {
			return directory ? `No notes found in "${directory}"` : 'No notes in vault';
		}
		return filtered
			.map(f => f.path)
			.sort()
			.join('\n');
	}

	async searchNotes(query: string): Promise<string> {
		const files = this.app.vault.getMarkdownFiles();
		const results: string[] = [];
		const queryLower = query.toLowerCase();

		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			if (!content.toLowerCase().includes(queryLower)) continue;

			const matchingLines = content
				.split('\n')
				.map((line, i) => ({ line, i }))
				.filter(({ line }) => line.toLowerCase().includes(queryLower))
				.slice(0, MAX_MATCHING_LINES)
				.map(({ line, i }) => `  L${i + 1}: ${line.trim()}`);

			results.push(`${file.path}\n${matchingLines.join('\n')}`);
			if (results.length >= MAX_SEARCH_RESULTS) break;
		}

		return results.length > 0 ? results.join('\n\n') : `No notes found containing "${query}"`;
	}

	private async ensureDir(path: string): Promise<void> {
		if (!this.app.vault.getAbstractFileByPath(path)) {
			await this.app.vault.createFolder(path);
		}
	}
}

function normalizePath(p: string): string {
	// Remove leading slash and clean double-slashes
	return p.replace(/^\/+/, '').replace(/\/+/g, '/').trim();
}

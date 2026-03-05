import { App, TFile, TFolder } from 'obsidian';
import { ToolDefinition } from '../types';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'read_note',
			description: 'Read the full content of a note. Use "active" as the path to read the currently open note.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to the note relative to vault root (e.g. "folder/note.md"), or "active" for the currently open note.',
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
			description: 'Overwrite a note with entirely new content. Creates the note if it does not exist. Use for full rewrites.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to the note relative to vault root, or "active" for the currently open note.',
					},
					content: {
						type: 'string',
						description: 'The complete new content for the note.',
					},
				},
				required: ['path', 'content'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'patch_note',
			description: 'Replace a specific block of text within a note. Use for surgical, targeted edits. The old_text must be an exact match of text that exists in the note.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path to the note relative to vault root, or "active" for the currently open note.',
					},
					old_text: {
						type: 'string',
						description: 'The exact text to find in the note. Must match character-for-character.',
					},
					new_text: {
						type: 'string',
						description: 'The replacement text.',
					},
				},
				required: ['path', 'old_text', 'new_text'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'create_note',
			description: 'Create a brand-new note. Fails if the note already exists.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Path for the new note relative to vault root (e.g. "folder/new-note.md").',
					},
					content: {
						type: 'string',
						description: 'Initial content of the note.',
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
			description: 'List notes and sub-folders inside a vault folder.',
			parameters: {
				type: 'object',
				properties: {
					folder: {
						type: 'string',
						description: 'Folder path relative to vault root. Use "/" or "" for the vault root.',
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
			description: 'Search for notes whose content contains the given text (case-insensitive). Returns matching file paths with context lines.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The text to search for.',
					},
				},
				required: ['query'],
			},
		},
	},
];

export interface EditRequest {
	path: string;
	originalContent: string;
	newContent: string;
	operation: 'write' | 'patch';
}

export interface ToolResult {
	success: boolean;
	result: string;
	editRequest?: EditRequest;
}

export class ToolExecutor {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async execute(name: string, argsJson: string): Promise<ToolResult> {
		let args: Record<string, string | undefined>;
		try {
			args = JSON.parse(argsJson) as Record<string, string | undefined>;
		} catch {
			return { success: false, result: 'Invalid tool arguments: could not parse JSON.' };
		}

		const missing = (key: string): ToolResult => ({
			success: false,
			result: `Missing required argument: ${key}`,
		});

		switch (name) {
			case 'read_note':
				if (!args.path) return missing('path');
				return this.readNote(args.path);
			case 'write_note':
				if (!args.path) return missing('path');
				if (args.content === undefined) return missing('content');
				return this.prepareWriteNote(args.path, args.content);
			case 'patch_note':
				if (!args.path) return missing('path');
				if (!args.old_text) return missing('old_text');
				if (args.new_text === undefined) return missing('new_text');
				return this.preparePatchNote(args.path, args.old_text, args.new_text);
			case 'create_note':
				if (!args.path) return missing('path');
				if (args.content === undefined) return missing('content');
				return this.prepareCreateNote(args.path, args.content);
			case 'list_notes':
				return this.listNotes(args.folder ?? '');
			case 'search_notes':
				if (!args.query) return missing('query');
				return this.searchNotes(args.query);
			default:
				return { success: false, result: `Unknown tool: ${name}` };
		}
	}

	/** Apply a previously prepared edit to the vault. */
	async applyEdit(editRequest: EditRequest): Promise<void> {
		const { path, newContent } = editRequest;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, newContent);
		} else {
			// Ensure parent folders exist, then create
			const parts = path.split('/');
			if (parts.length > 1) {
				await this.ensureFolder(parts.slice(0, -1).join('/'));
			}
			await this.app.vault.create(path, newContent);
		}
	}

	// ── private helpers ─────────────────────────────────────────────────────

	private resolveActivePath(path: string): string | null {
		if (path === 'active') {
			return this.app.workspace.getActiveFile()?.path ?? null;
		}
		return path;
	}

	private async readNote(path: string): Promise<ToolResult> {
		const resolved = this.resolveActivePath(path);
		if (!resolved) return { success: false, result: 'No active note is currently open.' };

		const file = this.app.vault.getAbstractFileByPath(resolved);
		if (!(file instanceof TFile)) {
			return { success: false, result: `Note not found: ${resolved}` };
		}
		const content = await this.app.vault.read(file);
		return { success: true, result: content };
	}

	private async prepareWriteNote(path: string, content: string): Promise<ToolResult> {
		const resolved = this.resolveActivePath(path);
		if (!resolved) return { success: false, result: 'No active note is currently open.' };

		const file = this.app.vault.getAbstractFileByPath(resolved);
		const originalContent = file instanceof TFile ? await this.app.vault.read(file) : '';

		return {
			success: true,
			result: `Prepared write to: ${resolved}`,
			editRequest: { path: resolved, originalContent, newContent: content, operation: 'write' },
		};
	}

	private async preparePatchNote(path: string, oldText: string, newText: string): Promise<ToolResult> {
		const resolved = this.resolveActivePath(path);
		if (!resolved) return { success: false, result: 'No active note is currently open.' };

		const file = this.app.vault.getAbstractFileByPath(resolved);
		if (!(file instanceof TFile)) {
			return { success: false, result: `Note not found: ${resolved}` };
		}

		const originalContent = await this.app.vault.read(file);
		if (!originalContent.includes(oldText)) {
			const preview = oldText.length > 80 ? oldText.substring(0, 80) + '…' : oldText;
			return { success: false, result: `Text not found in note "${resolved}": "${preview}"` };
		}

		const newContent = originalContent.replace(oldText, newText);
		return {
			success: true,
			result: `Prepared patch for: ${resolved}`,
			editRequest: { path: resolved, originalContent, newContent, operation: 'patch' },
		};
	}

	private async prepareCreateNote(path: string, content: string): Promise<ToolResult> {
		if (this.app.vault.getAbstractFileByPath(path)) {
			return { success: false, result: `Note already exists: ${path}. Use write_note to update it.` };
		}
		return {
			success: true,
			result: `Prepared creation of: ${path}`,
			editRequest: { path, originalContent: '', newContent: content, operation: 'write' },
		};
	}

	private listNotes(folder: string): ToolResult {
		const folderPath = folder === '/' ? '' : folder;
		const target = folderPath
			? this.app.vault.getAbstractFileByPath(folderPath)
			: this.app.vault.getRoot();

		if (!(target instanceof TFolder)) {
			return { success: false, result: `Folder not found: ${folder || '/'}` };
		}

		const items = target.children.map(child =>
			child instanceof TFolder ? `📁 ${child.name}/` : `📄 ${child.name}`
		);
		return { success: true, result: items.join('\n') || '(empty folder)' };
	}

	private async searchNotes(query: string): Promise<ToolResult> {
		const files = this.app.vault.getMarkdownFiles();
		const results: string[] = [];

		for (const file of files) {
			if (results.length >= 20) break;
			const content = await this.app.vault.read(file);
			if (!content.toLowerCase().includes(query.toLowerCase())) continue;

			const matchLines = content
				.split('\n')
				.filter(l => l.toLowerCase().includes(query.toLowerCase()))
				.slice(0, 2)
				.join(' | ');
			results.push(`**${file.path}**: ${matchLines}`);
		}

		if (results.length === 0) {
			return { success: true, result: 'No notes found matching the query.' };
		}
		return { success: true, result: results.join('\n') };
	}

	private async ensureFolder(path: string): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
		await this.app.vault.createFolder(path);
	}
}

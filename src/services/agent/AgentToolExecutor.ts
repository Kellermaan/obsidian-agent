import { App, Modal, Setting } from 'obsidian';
import { AgentUndoOperation } from '../../models/types';
import { VaultAgentService } from '../VaultAgentService';
import { AgentToolRegistry } from './AgentToolRegistry';

export interface AgentToolExecutionOptions {
	implicitTargetPath: string | null;
	requireWriteConfirmation: boolean;
}

export interface AgentToolExecutionResult {
	result: string;
	undoOperation?: AgentUndoOperation;
}

export class AgentToolExecutor {
	private app: App;
	private vaultAgentService: VaultAgentService;
	private toolRegistry: AgentToolRegistry;

	constructor(app: App, vaultAgentService: VaultAgentService, toolRegistry: AgentToolRegistry) {
		this.app = app;
		this.vaultAgentService = vaultAgentService;
		this.toolRegistry = toolRegistry;
	}

	async executeTool(
		toolName: string,
		rawArguments: string,
		options: AgentToolExecutionOptions,
	): Promise<AgentToolExecutionResult> {
		let args: Record<string, unknown> = {};
		if (rawArguments.trim()) {
			try {
				args = JSON.parse(rawArguments) as Record<string, unknown>;
			} catch {
				throw new Error(`Invalid tool arguments for ${toolName}`);
			}
		}

		if (options.implicitTargetPath) {
			const mismatchReason = this.getImplicitTargetMismatchReason(toolName, args, options.implicitTargetPath);
			if (mismatchReason) {
				return { result: mismatchReason };
			}
		}

		if (this.toolRegistry.isWriteTool(toolName) && options.requireWriteConfirmation) {
			const approved = await this.confirmWriteAction(toolName, args);
			if (!approved) {
				return { result: `Cancelled by user: ${toolName}` };
			}
		}

		switch (toolName) {
			case 'list_files': {
				const limit = typeof args.limit === 'number' ? args.limit : 200;
				return { result: this.vaultAgentService.listFiles(limit) };
			}
			case 'read_file': {
				const path = this.getStringArg(args, 'path');
				return { result: await this.vaultAgentService.readFile(path) };
			}
			case 'write_file': {
				const path = this.getStringArg(args, 'path');
				const content = this.getStringArg(args, 'content');
				const previousContent = await this.vaultAgentService.readFileIfExists(path);
				const result = await this.vaultAgentService.writeFile(path, content);
				const undoOperation: AgentUndoOperation = previousContent === null
					? { type: 'delete_path', path }
					: { type: 'restore_file', path, content: previousContent };

				return { result, undoOperation };
			}
			case 'append_file': {
				const path = this.getStringArg(args, 'path');
				const content = this.getStringArg(args, 'content');
				const previousContent = await this.vaultAgentService.readFileIfExists(path);
				const result = await this.vaultAgentService.appendFile(path, content);
				if (previousContent === null) {
					return { result };
				}

				return {
					result,
					undoOperation: {
						type: 'restore_file',
						path,
						content: previousContent,
					},
				};
			}
			case 'create_folder': {
				const path = this.getStringArg(args, 'path');
				const existed = this.vaultAgentService.getAbstractPath(path) !== null;
				const result = await this.vaultAgentService.createFolder(path);
				if (existed) {
					return { result };
				}

				return {
					result,
					undoOperation: { type: 'delete_path', path },
				};
			}
			case 'rename_path': {
				const oldPath = this.getStringArg(args, 'oldPath');
				const newPath = this.getStringArg(args, 'newPath');
				const result = await this.vaultAgentService.renamePath(oldPath, newPath);
				return {
					result,
					undoOperation: {
						type: 'rename_path',
						oldPath: newPath,
						newPath: oldPath,
					},
				};
			}
			default:
				throw new Error(`Unsupported tool: ${toolName}`);
		}
	}

	private async confirmWriteAction(toolName: string, args: Record<string, unknown>): Promise<boolean> {
		return await new Promise<boolean>((resolve) => {
			const modal = new AgentWriteConfirmModal(this.app, toolName, JSON.stringify(args, null, 2), resolve);
			modal.open();
		});
	}

	private getStringArg(args: Record<string, unknown>, key: string): string {
		const value = args[key];
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Missing required argument: ${key}`);
		}

		return value;
	}

	private getImplicitTargetMismatchReason(toolName: string, args: Record<string, unknown>, implicitTargetPath: string): string | null {
		if (toolName === 'write_file' || toolName === 'append_file') {
			const path = args.path;
			if (typeof path === 'string' && path !== implicitTargetPath) {
				return `Blocked: user referred to the current document. Use path "${implicitTargetPath}" for this edit.`;
			}
		}

		if (toolName === 'rename_path') {
			const oldPath = args.oldPath;
			if (typeof oldPath === 'string' && oldPath !== implicitTargetPath) {
				return `Blocked: user referred to the current document. Use oldPath "${implicitTargetPath}" if renaming this document.`;
			}
		}

		return null;
	}
}

class AgentWriteConfirmModal extends Modal {
	private toolName: string;
	private argsPreview: string;
	private resolver: (approved: boolean) => void;
	private resolved: boolean;

	constructor(app: App, toolName: string, argsPreview: string, resolver: (approved: boolean) => void) {
		super(app);
		this.toolName = toolName;
		this.argsPreview = argsPreview;
		this.resolver = resolver;
		this.resolved = false;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Confirm write action' });
		contentEl.createEl('p', { text: `Agent requested tool: ${this.toolName}` });

		const previewEl = contentEl.createEl('pre', { cls: 'agent-write-confirm-preview' });
		previewEl.setText(this.argsPreview);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('Allow')
					.setCta()
					.onClick(() => {
						this.resolveOnce(true);
						this.close();
					})
			)
			.addButton((button) =>
				button
					.setButtonText('Cancel')
					.onClick(() => {
						this.resolveOnce(false);
						this.close();
					})
			);
	}

	onClose(): void {
		this.resolveOnce(false);
		this.contentEl.empty();
	}

	private resolveOnce(value: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolver(value);
	}
}
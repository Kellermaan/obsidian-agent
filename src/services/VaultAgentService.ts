import { App, TAbstractFile, TFile, TFolder, normalizePath } from 'obsidian';

export class VaultAgentService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	listFiles(limit: number = 200): string {
		const files = this.app.vault.getMarkdownFiles().map((file) => file.path).slice(0, limit);
		return files.length > 0 ? files.join('\n') : 'No markdown files found.';
	}

	async readFile(path: string): Promise<string> {
		const normalizedPath = normalizePath(path);
		const file = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(file instanceof TFile)) {
			throw new Error(`File not found: ${normalizedPath}`);
		}

		const content = await this.app.vault.cachedRead(file);
		return content.length > 12000 ? `${content.slice(0, 12000)}\n\n[Content truncated]` : content;
	}

	async writeFile(path: string, content: string): Promise<string> {
		const normalizedPath = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			return `Updated file: ${normalizedPath}`;
		}

		await this.ensureParentFolder(normalizedPath);
		await this.app.vault.create(normalizedPath, content);
		return `Created file: ${normalizedPath}`;
	}

	async appendFile(path: string, content: string): Promise<string> {
		const normalizedPath = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(existing instanceof TFile)) {
			throw new Error(`File not found: ${normalizedPath}`);
		}

		const current = await this.app.vault.cachedRead(existing);
		await this.app.vault.modify(existing, `${current}${content}`);
		return `Appended to file: ${normalizedPath}`;
	}

	async createFolder(path: string): Promise<string> {
		const normalizedPath = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (existing) {
			return `Path already exists: ${normalizedPath}`;
		}

		await this.app.vault.createFolder(normalizedPath);
		return `Created folder: ${normalizedPath}`;
	}

	async renamePath(oldPath: string, newPath: string): Promise<string> {
		const normalizedOldPath = normalizePath(oldPath);
		const normalizedNewPath = normalizePath(newPath);
		const existing = this.app.vault.getAbstractFileByPath(normalizedOldPath);
		if (!existing) {
			throw new Error(`Path not found: ${normalizedOldPath}`);
		}

		await this.ensureParentFolder(normalizedNewPath);
		await this.app.fileManager.renameFile(existing, normalizedNewPath);
		return `Renamed: ${normalizedOldPath} -> ${normalizedNewPath}`;
	}

	getAbstractPath(path: string): TAbstractFile | null {
		const normalizedPath = normalizePath(path);
		return this.app.vault.getAbstractFileByPath(normalizedPath);
	}

	async readFileIfExists(path: string): Promise<string | null> {
		const file = this.getAbstractPath(path);
		if (!(file instanceof TFile)) return null;
		return await this.app.vault.cachedRead(file);
	}

	isFolder(path: string): boolean {
		return this.getAbstractPath(path) instanceof TFolder;
	}

	async deletePath(path: string): Promise<string> {
		const abstractPath = this.getAbstractPath(path);
		if (!abstractPath) {
			return `Path already missing: ${normalizePath(path)}`;
		}

		await this.app.fileManager.trashFile(abstractPath);
		return `Deleted path: ${normalizePath(path)}`;
	}

	private async ensureParentFolder(path: string): Promise<void> {
		const parts = path.split('/');
		parts.pop();
		if (parts.length === 0) return;

		const folderPath = normalizePath(parts.join('/'));
		if (folderPath === '.') return;

		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (existing) return;

		await this.app.vault.createFolder(folderPath);
	}
}

import { App, Modal } from 'obsidian';
import { EditRequest } from '../ai/tools';

/**
 * Shows a before/after diff of a proposed note edit and lets the user
 * accept or reject the change before it is written to the vault.
 */
export class DiffModal extends Modal {
private editRequest: EditRequest;
private onAccept: () => void;
private onReject: () => void;

constructor(
app: App,
editRequest: EditRequest,
onAccept: () => void,
onReject: () => void,
) {
super(app);
this.editRequest = editRequest;
this.onAccept = onAccept;
this.onReject = onReject;
}

onOpen(): void {
const { contentEl, modalEl } = this;
modalEl.addClass('agent-diff-modal');

const { path, originalContent, newContent } = this.editRequest;

contentEl.createEl('h3', { text: `Edit proposal: ${path}`, cls: 'agent-diff-title' });

if (!originalContent) {
// New file – just show what will be created
contentEl.createEl('p', { text: 'A new note will be created with the following content:' });
const pre = contentEl.createEl('pre', { cls: 'agent-diff-new-content' });
pre.createEl('code', { text: newContent });
} else {
// Existing file – side-by-side comparison
contentEl.createEl('p', {
text: 'Review the proposed changes below. Left panel shows current content; right panel shows the result.',
cls: 'agent-diff-subtitle',
});

const grid = contentEl.createDiv({ cls: 'agent-diff-grid' });

const oldCol = grid.createDiv({ cls: 'agent-diff-col agent-diff-col--old' });
oldCol.createEl('div', { text: 'Before', cls: 'agent-diff-col-header' });
oldCol.createEl('pre', { cls: 'agent-diff-code' }).createEl('code', { text: originalContent });

const newCol = grid.createDiv({ cls: 'agent-diff-col agent-diff-col--new' });
newCol.createEl('div', { text: 'After', cls: 'agent-diff-col-header' });
newCol.createEl('pre', { cls: 'agent-diff-code' }).createEl('code', { text: newContent });
}

const footer = contentEl.createDiv({ cls: 'agent-diff-footer' });

const acceptBtn = footer.createEl('button', { text: 'Apply changes', cls: 'mod-cta agent-diff-btn' });
acceptBtn.addEventListener('click', () => {
this.close();
this.onAccept();
});

const rejectBtn = footer.createEl('button', { text: 'Reject', cls: 'agent-diff-btn' });
rejectBtn.addEventListener('click', () => {
this.close();
this.onReject();
});
}

onClose(): void {
this.contentEl.empty();
}
}

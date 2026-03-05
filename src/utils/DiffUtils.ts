export interface DiffLine {
	type: 'equal' | 'add' | 'delete' | 'collapsed';
	content: string;
}

/** Maximum number of lines for which LCS-based diff is computed (O(m*n) time). */
const MAX_LINES_FOR_LCS = 400;

/** Lines of unchanged context shown around each changed block. */
const CONTEXT_LINES = 3;

/**
 * Compute a line-by-line unified diff between two texts.
 * Unchanged sections are collapsed to at most CONTEXT_LINES of context,
 * with a summary line showing how many lines were hidden.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
	const oldLines = oldText === '' ? [] : oldText.split('\n');
	const newLines = newText === '' ? [] : newText.split('\n');

	let raw: DiffLine[];
	if (oldLines.length <= MAX_LINES_FOR_LCS && newLines.length <= MAX_LINES_FOR_LCS) {
		raw = lcsLineDiff(oldLines, newLines);
	} else {
		// Fallback for very large files: show all removals then all additions
		raw = [
			...oldLines.map(l => ({ type: 'delete' as const, content: l })),
			...newLines.map(l => ({ type: 'add' as const, content: l })),
		];
	}

	return collapseContext(raw, CONTEXT_LINES);
}

/** LCS-based line diff via dynamic programming. */
function lcsLineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
	const m = oldLines.length;
	const n = newLines.length;

	// dp[i][j] = LCS length for oldLines[0..i-1] and newLines[0..j-1]
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i]![j] = dp[i - 1]![j - 1]! + 1;
			} else {
				dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
			}
		}
	}

	// Backtrack to build the diff
	const result: DiffLine[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			result.unshift({ type: 'equal', content: oldLines[i - 1]! });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
			result.unshift({ type: 'add', content: newLines[j - 1]! });
			j--;
		} else {
			result.unshift({ type: 'delete', content: oldLines[i - 1]! });
			i--;
		}
	}
	return result;
}

/** Collapse unchanged regions, keeping `context` lines around each change. */
function collapseContext(diff: DiffLine[], context: number): DiffLine[] {
	if (diff.length === 0) return diff;

	// Mark every index that should be visible
	const visible = new Uint8Array(diff.length);
	for (let i = 0; i < diff.length; i++) {
		if (diff[i]!.type !== 'equal') {
			const start = Math.max(0, i - context);
			const end = Math.min(diff.length - 1, i + context);
			for (let k = start; k <= end; k++) visible[k] = 1;
		}
	}

	const result: DiffLine[] = [];
	let i = 0;
	while (i < diff.length) {
		if (visible[i]) {
			result.push(diff[i]!);
			i++;
		} else {
			// Count the run of hidden equal lines
			let j = i;
			while (j < diff.length && !visible[j]) j++;
			const count = j - i;
			result.push({ type: 'collapsed', content: `⋯ ${count} unchanged line${count !== 1 ? 's' : ''} ⋯` });
			i = j;
		}
	}
	return result;
}

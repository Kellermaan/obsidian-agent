export type AgentRunMode = 'chat' | 'plan' | 'act';

export const AGENT_RUN_MODE_LABELS: Record<AgentRunMode, string> = {
	chat: 'Chat',
	plan: 'Plan',
	act: 'Act',
};

const AGENT_RUN_MODE_ORDER: AgentRunMode[] = ['chat', 'plan', 'act'];

export function getAgentRunModeLabel(mode: AgentRunMode): string {
	return AGENT_RUN_MODE_LABELS[mode];
}

export function getNextAgentRunMode(mode: AgentRunMode): AgentRunMode {
	const currentIndex = AGENT_RUN_MODE_ORDER.indexOf(mode);
	const nextIndex = (currentIndex + 1) % AGENT_RUN_MODE_ORDER.length;
	return AGENT_RUN_MODE_ORDER[nextIndex] ?? 'chat';
}

export function isAgentActionMode(mode: AgentRunMode): mode is Exclude<AgentRunMode, 'chat'> {
	return mode === 'plan' || mode === 'act';
}

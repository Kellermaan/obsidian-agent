export interface LLMService {
	streamResponse(
		messages: { role: string; content: string }[],
		onChunk: (chunk: string) => void,
		onError: (error: Error) => void,
		onComplete: () => void
	): Promise<void>;
}

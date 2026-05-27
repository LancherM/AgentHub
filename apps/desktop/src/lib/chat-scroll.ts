export interface ChatScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 72;

export function isChatScrollNearBottom(
  metrics: ChatScrollMetrics,
  thresholdPx = CHAT_SCROLL_BOTTOM_THRESHOLD_PX
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx;
}

export function shouldFollowChatScroll(input: {
  readonly threadChanged: boolean;
  readonly wasPinnedToBottom: boolean;
  readonly metrics: ChatScrollMetrics;
  readonly thresholdPx?: number;
}): boolean {
  return (
    input.threadChanged ||
    input.wasPinnedToBottom ||
    isChatScrollNearBottom(input.metrics, input.thresholdPx)
  );
}

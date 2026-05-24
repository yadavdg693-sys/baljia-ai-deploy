interface ChatScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function isChatScrolledAwayFromBottom(metrics: ChatScrollMetrics, thresholdPx = 96): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > thresholdPx;
}

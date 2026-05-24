import { describe, expect, it } from 'vitest';
import { isChatScrolledAwayFromBottom } from './chat-scroll';

describe('FounderChatRail scroll affordance', () => {
  it('shows the jump-to-latest affordance only when the chat is meaningfully above the bottom', () => {
    expect(isChatScrolledAwayFromBottom({
      scrollHeight: 1600,
      scrollTop: 600,
      clientHeight: 700,
    })).toBe(true);

    expect(isChatScrolledAwayFromBottom({
      scrollHeight: 1600,
      scrollTop: 840,
      clientHeight: 700,
    })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isChatScrollNearBottom,
  shouldFollowChatScroll
} from "../apps/desktop/src/lib/chat-scroll";

describe("isChatScrollNearBottom", () => {
  it("treats the configured threshold as the sticky bottom zone", () => {
    expect(
      isChatScrollNearBottom({
        scrollTop: 928,
        scrollHeight: 1_500,
        clientHeight: 500
      })
    ).toBe(true);

    expect(
      isChatScrollNearBottom({
        scrollTop: 850,
        scrollHeight: 1_500,
        clientHeight: 500
      })
    ).toBe(false);
  });
});

describe("shouldFollowChatScroll", () => {
  it("follows on thread changes even when the old room was scrolled up", () => {
    expect(
      shouldFollowChatScroll({
        threadChanged: true,
        wasPinnedToBottom: false,
        metrics: {
          scrollTop: 200,
          scrollHeight: 1_500,
          clientHeight: 500
        }
      })
    ).toBe(true);
  });

  it("does not pull the user back down while they are reading older messages", () => {
    expect(
      shouldFollowChatScroll({
        threadChanged: false,
        wasPinnedToBottom: false,
        metrics: {
          scrollTop: 200,
          scrollHeight: 1_500,
          clientHeight: 500
        }
      })
    ).toBe(false);
  });
});

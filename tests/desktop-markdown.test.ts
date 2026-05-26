import { describe, expect, it } from "vitest";
import {
  markdownComponents,
  markdownImageLabel
} from "../apps/desktop/src/components/chat/markdown-components";

describe("desktop markdown rendering helpers", () => {
  it("renders image syntax as an inert placeholder instead of an auto-loaded resource", () => {
    expect(markdownImageLabel("Architecture diagram")).toBe(
      "Image omitted: Architecture diagram"
    );
    expect(markdownImageLabel("   ")).toBe("Image omitted");

    const imageRenderer = markdownComponents.img as unknown as
      | ((props: { alt?: string; src?: string }) => unknown)
      | undefined;
    expect(typeof imageRenderer).toBe("function");
    if (typeof imageRenderer !== "function") {
      return;
    }

    const rendered = imageRenderer({
      alt: "tracking pixel",
      src: "https://example.invalid/pixel.png"
    }) as { type: string; props: Record<string, unknown> };

    expect(rendered.type).toBe("span");
    expect(rendered.props).toMatchObject({
      className: "markdown-image-placeholder",
      role: "note",
      children: "Image omitted: tracking pixel"
    });
    expect(rendered.props).not.toHaveProperty("src");
  });
});

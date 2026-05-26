import { createElement } from "react";
import type { Components } from "react-markdown";

export function markdownImageLabel(alt: string | undefined): string {
  const label = alt?.trim();
  return label ? `Image omitted: ${label}` : "Image omitted";
}

export const markdownComponents: Components = {
  a({ children, href, ...props }) {
    const external = typeof href === "string" && !href.startsWith("#");
    return createElement(
      "a",
      {
        ...props,
        href,
        rel: external ? "noreferrer" : undefined,
        target: external ? "_blank" : undefined
      },
      children
    );
  },
  img({ alt }) {
    return createElement(
      "span",
      {
        className: "markdown-image-placeholder",
        role: "note"
      },
      markdownImageLabel(alt)
    );
  }
};

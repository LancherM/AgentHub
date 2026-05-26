import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isExternalLink(href: string): boolean {
  if (href.startsWith("#")) {
    return false;
  }

  try {
    const parsed = new URL(href, "https://agent-hub.local");
    return EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function handleExternalLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  event.preventDefault();
  window.open(href, "_blank", "noopener,noreferrer");
}

interface MarkdownTextProps {
  text: string;
  compact?: boolean;
}

const components: Components = {
  a({ children, href, ...props }) {
    const external = typeof href === "string" && isExternalLink(href);
    return (
      <a
        {...props}
        href={href}
        rel={external ? "noreferrer noopener" : undefined}
        target={external ? "_blank" : undefined}
        onClick={external && href ? (event) => handleExternalLinkClick(event, href) : undefined}
      >
        {children}
      </a>
    );
  }
};

export function MarkdownText({ text, compact = false }: MarkdownTextProps): JSX.Element {
  return (
    <div className={`markdown-message${compact ? " compact" : ""}`}>
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

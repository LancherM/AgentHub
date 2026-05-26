import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  text: string;
  compact?: boolean;
}

const components: Components = {
  a({ children, href, ...props }) {
    const external = typeof href === "string" && !href.startsWith("#");
    return (
      <a
        {...props}
        href={href}
        rel={external ? "noreferrer" : undefined}
        target={external ? "_blank" : undefined}
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

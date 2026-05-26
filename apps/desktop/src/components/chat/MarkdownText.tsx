import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "./markdown-components";

interface MarkdownTextProps {
  text: string;
  compact?: boolean;
}

export function MarkdownText({ text, compact = false }: MarkdownTextProps): JSX.Element {
  return (
    <div className={`markdown-message${compact ? " compact" : ""}`}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

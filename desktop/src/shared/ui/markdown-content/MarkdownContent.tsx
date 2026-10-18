import { Children, createContext, isValidElement, type ComponentPropsWithoutRef, type ReactNode, useContext, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkGfm from "remark-gfm";
import { CapabilityToken } from "../capability-token";
import { CAPABILITY_LINK_PREFIX, remarkCapabilityTokens } from "./capability-tokens";
import styles from "./MarkdownContent.module.css";
import { MarkdownImage } from "../image-preview/MarkdownImage";
import { isLocalImageLink } from "../image-preview/image-reference";
import { remarkSearchHighlights, searchParts } from "./search-highlights";

const SearchQueryContext = createContext("");
function SearchCode({ children, className }: { children?: ReactNode; className?: string }) {
  const query = useContext(SearchQueryContext);
  return <code className={className}>{typeof children === "string" && query
    ? searchParts(children, query).map((part, index) => part.matched ? <mark key={index}>{part.text}</mark> : part.text)
    : children}</code>;
}

const markdownUrlTransform: UrlTransform = (url, key, node) => {
  const image = key === "src" && node.tagName === "img";
  if (image && /^data:image\//i.test(url)) return url;
  const localPath = /^(?:file:|[a-z]:[\\/])/i.test(url);
  if (localPath && (image || key === "href" && node.tagName === "a" && isLocalImageLink(url, window.location.href))) return url;
  return defaultUrlTransform(url);
};

function codeText(children: ReactNode): string {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ children?: ReactNode }>(child)) return "";
  return String(child.props.children ?? "").replace(/\n$/, "");
}

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(child) ? child.props.className ?? "" : "";
  const language = className.match(/language-([^\s]+)/)?.[1];
  const content = codeText(children);

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return <div className={styles.codeBlock}>
    <div className={styles.codeToolbar}>
      <span>{language ?? t("common.code")}</span>
      <button type="button" onClick={() => void copy()} aria-label={copied ? t("common.copied") : t("common.copy")}>
        {copied ? <Check /> : <Copy />}
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </div>
    <pre {...props}>{children}</pre>
  </div>;
}

const markdownComponents: Components = {
  pre: CodeBlock,
  code: SearchCode,
  img: ({ src, alt }) => <MarkdownImage src={typeof src === "string" ? src : ""} name={alt ?? ""} />,
  a: ({ children: label, href, ...props }) => href?.startsWith(CAPABILITY_LINK_PREFIX)
    ? <CapabilityToken kind={href.startsWith(`${CAPABILITY_LINK_PREFIX}mcp-`) ? "mcp" : "skill"} label={label} />
    : href && isLocalImageLink(href, window.location.href)
      ? <MarkdownImage src={href} name={typeof label === "string" ? label : href.split(/[\\/]/).at(-1) ?? ""} />
      : <a {...props} href={href} target="_blank" rel="noreferrer">{label}</a>,
  table: ({ children: rows, ...props }) => <div className={styles.tableScroll}><table {...props}>{rows}</table></div>,
};

export function MarkdownContent({ children, className = "", highlightQuery = "" }: { children: string; className?: string; highlightQuery?: string }) {
  return <SearchQueryContext.Provider value={highlightQuery}><div className={`${styles.root} ${className}`.trim()}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkCapabilityTokens, [remarkSearchHighlights, { query: highlightQuery }]]}
      urlTransform={markdownUrlTransform}
      components={markdownComponents}
    >{children}</ReactMarkdown>
  </div></SearchQueryContext.Provider>;
}

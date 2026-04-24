// Shared markdown renderer — used by chat messages + document viewers.
// Renders GitHub-flavored markdown (GFM) with dark-theme-friendly styles.

'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownBodyProps {
  children: string;
  /** Optional size variant — 'sm' for compact chat bubbles, 'base' for docs. */
  size?: 'sm' | 'base';
  className?: string;
}

export function MarkdownBody({ children, size = 'base', className = '' }: MarkdownBodyProps) {
  const textSize = size === 'sm' ? 'text-sm' : 'text-base';

  return (
    <div className={`${textSize} leading-relaxed break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h1 className="text-xl font-semibold mt-4 mb-2" {...props} />,
          h2: (props) => <h2 className="text-lg font-semibold mt-4 mb-2" {...props} />,
          h3: (props) => <h3 className="text-base font-semibold mt-3 mb-2" {...props} />,
          h4: (props) => <h4 className="text-sm font-semibold mt-3 mb-1" {...props} />,
          p: (props) => <p className="my-2" {...props} />,
          ul: (props) => <ul className="list-disc pl-5 my-2 space-y-1" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-1" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          strong: (props) => <strong className="font-semibold text-text-primary" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          a: (props) => (
            <a
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
              style={{ color: 'var(--color-baljia-gold, #F5A623)' }}
              target={props.href?.startsWith('http') ? '_blank' : undefined}
              rel={props.href?.startsWith('http') ? 'noopener noreferrer' : undefined}
              {...props}
            />
          ),
          code: ({ className: codeClass, children: codeChildren, ...rest }) => {
            const isInline = !/language-/.test(codeClass ?? '');
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-surface-secondary font-mono text-[0.875em]"
                  {...rest}
                >
                  {codeChildren}
                </code>
              );
            }
            return (
              <code className={`${codeClass} font-mono`} {...rest}>
                {codeChildren}
              </code>
            );
          },
          pre: (props) => (
            <pre className="my-2 p-3 rounded-lg bg-surface-secondary overflow-x-auto text-sm" {...props} />
          ),
          blockquote: (props) => (
            <blockquote className="my-2 pl-4 border-l-2 border-border-default text-text-secondary italic" {...props} />
          ),
          hr: () => <hr className="my-4 border-border-default" />,
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-sm border-collapse" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="px-3 py-2 text-left font-semibold border-b border-border-default" {...props} />
          ),
          td: (props) => <td className="px-3 py-2 border-b border-border-default/50" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

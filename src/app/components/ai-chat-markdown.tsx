import Link from "next/link";
import type { Alignment, Block, Inline } from "@/lib/chat/markdown";

// Renders an answer read by parseMarkdown. Everything is React elements: nothing the model writes becomes markup.

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={index}><InlineNodes nodes={node.children} /></strong>;
      case "em":
        return <em key={index}><InlineNodes nodes={node.children} /></em>;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "link":
        return <Link key={index} href={node.href}><InlineNodes nodes={node.children} /></Link>;
      case "break":
        return <br key={index} />;
    }
  });
}

// Columns of figures line up on the right, as in the financial tables, even when the table marks them ":---" (the
// models write that for every column).
function cellClass(align: Alignment, numeric: boolean, wrap: boolean): string | undefined {
  const side = numeric && align !== "center" ? "right" : align;
  const classes = [
    side === "right" ? "ai-chat-cell-right" : side === "center" ? "ai-chat-cell-center" : "",
    numeric ? "ai-chat-cell-number" : "",
    wrap ? "ai-chat-cell-wrap" : "",
  ].filter(Boolean);
  return classes.length ? classes.join(" ") : undefined;
}

function BlockNode({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p><InlineNodes nodes={block.content} /></p>;
    case "heading":
      return <p className="ai-chat-markdown-heading"><InlineNodes nodes={block.content} /></p>;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <InlineNodes nodes={item.content} />
          {item.children.map((child, childIndex) => <BlockNode key={childIndex} block={child} />)}
        </li>
      ));
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div className="ai-chat-table-scroll">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, column) => (
                  <th key={column} scope="col" className={cellClass(block.align[column], block.numeric[column], block.wrap[column])}><InlineNodes nodes={cell} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column} className={cellClass(block.align[column], block.numeric[column], block.wrap[column])}><InlineNodes nodes={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return <pre><code>{block.text}</code></pre>;
    case "rule":
      return <hr />;
  }
}

export function ChatMarkdown({ blocks }: { blocks: Block[] }) {
  return (
    <div className="ai-chat-markdown">
      {blocks.map((block, index) => <BlockNode key={index} block={block} />)}
    </div>
  );
}

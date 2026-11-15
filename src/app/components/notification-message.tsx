import Link from "next/link";
import type { ReactNode } from "react";
import { parseTelegramHtml, type MessageNode } from "@/lib/telegram-html";

// A notification's message on the page: its Telegram HTML read into React elements (telegram-html.ts), never
// inserted as HTML. Line breaks are kept by the `notification-message` style.
function render(nodes: MessageNode[], prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    switch (node.type) {
      case "text":
        return node.text;
      case "bold":
        return <strong key={key}>{render(node.children, `${key}.`)}</strong>;
      case "italic":
        return <em key={key}>{render(node.children, `${key}.`)}</em>;
      case "link":
        return node.external
          ? <a key={key} href={node.href} target="_blank" rel="noreferrer">{render(node.children, `${key}.`)}</a>
          : <Link key={key} href={node.href}>{render(node.children, `${key}.`)}</Link>;
    }
  });
}

export function NotificationMessage({ body }: { body: string }) {
  return <div className="notification-message">{render(parseTelegramHtml(body, process.env.APP_URL), "")}</div>;
}

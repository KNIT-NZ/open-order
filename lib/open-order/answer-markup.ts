import { createElement, type ReactNode } from "react";
import { renderAiAnswerHtml } from "./format";

// The existing formatter emits only this fixed vocabulary. Convert it into React
// elements instead of inserting HTML. Unknown markup never becomes an element.
const tags = {
  div: new Set(["oo-aiSectionGroup", "oo-aiSectionHeading"]),
  p: new Set(["oo-aiParagraph"]),
  span: new Set(["oo-aiAuthorityPill", "oo-aiInlineLabel", "oo-aiInlineLabelColon"]),
  ul: new Set(["oo-aiList"]),
  li: new Set(["oo-aiListItem"]),
  hr: new Set(["oo-aiSectionRule"]),
} as const;
type Tag = keyof typeof tags;
type Frame = { tag: Tag; className: string; children: ReactNode[]; key: number };
function decodeText(text: string): string {
  return text.replace(/&(?:amp|lt|gt);/g, (entity) =>
    entity === "&amp;" ? "&" : entity === "&lt;" ? "<" : ">");
}
function isTag(tag: string): tag is Tag {
  return Object.prototype.hasOwnProperty.call(tags, tag);
}
export function renderAiAnswerNodes(answerText: string): ReactNode[] {
  const html = renderAiAnswerHtml(answerText);
  const root: ReactNode[] = [];
  const stack: Frame[] = [];
  const append = (node: ReactNode) => (stack[stack.length - 1]?.children ?? root).push(node);
  let key = 0;
  for (const part of html.split(/(<[^>]*>)/g).filter(Boolean)) {
    if (!part.startsWith("<")) { append(decodeText(part)); continue; }
    const open = /^<(div|p|span|ul|li|hr) class="(oo-[A-Za-z]+)"( \/)?>$/.exec(part);
    if (open && isTag(open[1]) && tags[open[1]].has(open[2])) {
      const tag = open[1];
      if (tag === "hr" && open[3]) append(createElement(tag, { className: open[2], key: key++ }));
      else if (tag !== "hr" && !open[3]) stack.push({ tag, className: open[2], children: [], key: key++ });
      else return [answerText];
      continue;
    }
    const close = /^<\/(div|p|span|ul|li)>$/.exec(part);
    if (close) {
      const frame = stack.pop();
      if (!frame || frame.tag !== close[1]) return [answerText];
      append(createElement(frame.tag, { className: frame.className, key: frame.key }, ...frame.children));
      continue;
    }
    // Fail closed if the formatter vocabulary ever changes unexpectedly.
    return [answerText];
  }
  return stack.length ? [answerText] : root;
}

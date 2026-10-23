// The light formatting in the assistant's answers - bold, bullet lists, numbered steps, links -
// read into blocks the help screen renders, so no markdown symbol is ever shown as such. Anything
// else stays plain text. No imports, so a plain Node test (helpMarkdown.test.mjs) runs it.

export type Inline = { type: 'text'; text: string } | { type: 'bold'; text: string } | { type: 'link'; text: string; url: string };

export type Block =
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'numbered'; items: Inline[][] };

const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;

// **bold**, [text](https://...) and bare https:// links. Other symbols (*, _, #, `) are dropped
// when they are only formatting.
export function parseInline(line: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index! > last) parts.push({ type: 'text', text: line.slice(last, match.index) });
    if (match[1] != null) parts.push({ type: 'bold', text: match[1] });
    else if (match[2] != null) {
      parts.push(SAFE_URL.test(match[3]) ? { type: 'link', text: match[2], url: match[3] } : { type: 'text', text: match[2] });
    } else if (match[4] != null) {
      const url = match[4].replace(/[.,;:!?]+$/, '');
      parts.push({ type: 'link', text: url, url });
      if (url.length < match[4].length) parts.push({ type: 'text', text: match[4].slice(url.length) });
    }
    last = match.index! + match[0].length;
  }
  if (last < line.length) parts.push({ type: 'text', text: line.slice(last) });
  // Leftover single markers (*italic*, `code`, __x__) and headings: keep the words, drop the symbols.
  return parts
    .map((part) => (part.type === 'text' ? { ...part, text: part.text.replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/[*_`]{1,2}([^*_`]+)[*_`]{1,2}/g, '$1') } : part))
    .filter((part) => part.text.length > 0);
}

export function parseHelpMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ').trim()) });
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (bullet || numbered) {
      flush();
      const type = bullet ? 'bullets' : 'numbered';
      const item = parseInline((bullet ?? numbered)![1]);
      const previous = blocks[blocks.length - 1];
      if (previous && previous.type === type) previous.items.push(item);
      else blocks.push({ type, items: [item] } as Block);
    } else {
      paragraph.push(line.replace(/^#{1,6}\s+/, ''));
    }
  }
  flush();
  return blocks;
}

// The answer as plain text, for screen readers and previews.
export function plainText(text: string): string {
  return parseHelpMarkdown(text)
    .map((block) =>
      block.type === 'paragraph'
        ? block.inline.map((part) => part.text).join('')
        : block.items.map((item, index) => `${block.type === 'numbered' ? `${index + 1}. ` : ''}${item.map((part) => part.text).join('')}`).join('\n')
    )
    .join('\n');
}

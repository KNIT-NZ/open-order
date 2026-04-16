// lib/chunking,ts
import {
  cleanLine,
  isRulingStart,
  isStandingOrderStart,
  looksLikeAllCapsHeading,
  looksLikePlainHeading,
} from "@/lib/text";

export type ChunkedSection = {
  chunkIndex: number;
  content: string;
  tokenCountEst: number;
};

type ChunkOptions = {
  targetChars?: number;
  maxChars?: number;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalizeText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function isNumberedClauseStart(line: string): boolean {
  return /^\(\d+[A-Z]?\)\s+\S/.test(line);
}

function isLetterClauseStart(line: string): boolean {
  return /^\([a-z]\)\s+\S/.test(line);
}

function isRomanClauseStart(line: string): boolean {
  return /^\(([ivxlcdm]+)\)\s+\S/i.test(line);
}

function isBulletStart(line: string): boolean {
  return /^•\s+\S/.test(line);
}

function isSemanticHeading(line: string): boolean {
  return looksLikeAllCapsHeading(line) || looksLikePlainHeading(line);
}

function startsSemanticUnit(line: string): boolean {
  if (!line) return false;

  return (
    isRulingStart(line) ||
    isStandingOrderStart(line) ||
    isNumberedClauseStart(line) ||
    isLetterClauseStart(line) ||
    isRomanClauseStart(line) ||
    isBulletStart(line) ||
    isSemanticHeading(line)
  );
}

function pushBlock(blocks: string[], lines: string[]) {
  const block = lines.map(cleanLine).filter(Boolean).join(" ");
  if (block) {
    blocks.push(block);
  }
}

function splitSemanticBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let currentLines: string[] = [];

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);

    if (!line) {
      if (currentLines.length > 0) {
        pushBlock(blocks, currentLines);
        currentLines = [];
      }
      continue;
    }

    if (currentLines.length === 0) {
      currentLines.push(line);
      continue;
    }

    if (startsSemanticUnit(line)) {
      pushBlock(blocks, currentLines);
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    pushBlock(blocks, currentLines);
  }

  return blocks;
}

function findCutPoint(text: string, maxChars: number): number {
  const semanticBoundaryRegex =
    /\s(?=(\(\d+[A-Z]?\)|\([a-z]\)|\([ivxlcdm]+\)|•))/gi;

  let match: RegExpExecArray | null;
  let bestSemanticCut = -1;

  while ((match = semanticBoundaryRegex.exec(text)) !== null) {
    if (match.index <= maxChars) {
      bestSemanticCut = match.index;
    } else {
      break;
    }
  }

  if (bestSemanticCut >= Math.floor(maxChars * 0.55)) {
    return bestSemanticCut;
  }

  const punctuationCandidates = [
    text.lastIndexOf(". ", maxChars),
    text.lastIndexOf("; ", maxChars),
    text.lastIndexOf(": ", maxChars),
  ].filter((index) => index >= 0);

  if (punctuationCandidates.length > 0) {
    const bestPunctuationCut = Math.max(...punctuationCandidates) + 1;
    if (bestPunctuationCut >= Math.floor(maxChars * 0.55)) {
      return bestPunctuationCut;
    }
  }

  const lastSpace = text.lastIndexOf(" ", maxChars);
  if (lastSpace >= Math.floor(maxChars * 0.55)) {
    return lastSpace;
  }

  return maxChars;
}

function splitOversizedBlock(block: string, maxChars: number): string[] {
  const parts: string[] = [];
  let remaining = cleanLine(block);

  while (remaining.length > maxChars) {
    const cut = findCutPoint(remaining, maxChars);
    const part = cleanLine(remaining.slice(0, cut));

    if (part) {
      parts.push(part);
    }

    remaining = cleanLine(remaining.slice(cut));
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

export function chunkSectionText(
  text: string,
  options: ChunkOptions = {},
): ChunkedSection[] {
  const targetChars = options.targetChars ?? 1200;
  const maxChars = options.maxChars ?? 1800;

  const semanticBlocks = splitSemanticBlocks(text);
  if (semanticBlocks.length === 0) {
    return [];
  }

  const normalizedBlocks = semanticBlocks.flatMap((block) =>
    block.length <= maxChars ? [block] : splitOversizedBlock(block, maxChars),
  );

  const chunks: ChunkedSection[] = [];
  let current = "";
  let chunkIndex = 0;

  function flush() {
    const content = cleanLine(current);
    if (!content) return;

    chunks.push({
      chunkIndex,
      content,
      tokenCountEst: estimateTokens(content),
    });

    chunkIndex += 1;
    current = "";
  }

  for (const block of normalizedBlocks) {
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length <= targetChars) {
      current = candidate;
      continue;
    }

    if (current) {
      flush();
    }

    current = block;
  }

  if (current) {
    flush();
  }

  return chunks;
}
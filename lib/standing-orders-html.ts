// lib/standing-orders-html.ts
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import {
  cleanLine,
  dedupePath,
  extractStandingOrderNumberAndHeading,
  isStandingOrderStart,
  looksLikeAllCapsHeading,
} from "@/lib/text";

export const STANDING_ORDERS_INDEX_URL =
  "https://www3.parliament.nz/en/pb/parliamentary-rules/standing-orders-2023-by-chapter/";

export type ParsedStandingOrder = {
  orderNumber: string;
  orderLabel: string;
  chapterNumber: string;
  chapterTitle: string;
  partHeading: string | null;
  heading: string | null;
  path: string[];
  content: string;
  contentMarkdown: string;
  sourceUrl: string;
  sourceAnchor: string;
  metadata: {
    orderNumber: string;
    orderNumberRaw: string;
    chapterNumber: string;
    chapterTitle: string;
    partHeading: string | null;
  };
};

function slugify(input: string): string {
  return cleanLine(input)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeChapterTitle(input: string): string {
  const text = cleanLine(input);
  if (!text) return text;

  return text
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .replace(/\bAnd\b/g, "and")
    .replace(/\bThe\b/g, "the")
    .replace(/\bTo\b/g, "to")
    .replace(/\bIn\b/g, "in");
}

function parseChapterMeta($: cheerio.CheerioAPI): {
  chapterNumber: string;
  chapterTitle: string;
} {
  const h1 = cleanLine(
    $('#main-content .main[role="main"] h1').first().text() ||
      $("h1").first().text(),
  );

  const match = h1.match(/^Chapter\s+(\d+):\s*(.+)$/i);

  if (!match) {
    throw new Error(`Could not parse chapter metadata from H1: "${h1}"`);
  }

  return {
    chapterNumber: match[1],
    chapterTitle: normalizeChapterTitle(match[2]),
  };
}

function selectorExists($: cheerio.CheerioAPI, selector: string): boolean {
  return $(selector).length > 0;
}

export async function fetchHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    await page.waitForFunction(
      () =>
        !!document.querySelector('#main-content .main[role="main"] h1') ||
        !!document.querySelector("h1"),
      { timeout: 60000 },
    );

    return await page.content();
  } finally {
    await page.close();
    await browser.close();
  }
}

export function extractChapterUrls(indexHtml: string): string[] {
  const $ = cheerio.load(indexHtml);
  const urls = new Set<string>();

  const linkSelectors = [
    '#main-content .main[role="main"] a[href]',
    '.main[role="main"] a[href]',
    "main a[href]",
    "a[href]",
  ];

  for (const selector of linkSelectors) {
    $(selector).each((_, element) => {
      const rawHref = cleanLine($(element).attr("href") ?? "");
      if (!rawHref) return;

      let href: string;
      try {
        href = new URL(rawHref, STANDING_ORDERS_INDEX_URL).toString();
      } catch {
        return;
      }

      if (
        /^https:\/\/www3\.parliament\.nz\/en\/pb\/parliamentary-rules\/standing-orders-2023-by-chapter\/chapter-\d+-/.test(
          href,
        )
      ) {
        urls.add(href);
      }
    });

    if (urls.size > 0) {
      break;
    }
  }

  return [...urls].sort((a, b) => {
    const aMatch = a.match(/\/chapter-(\d+)-/);
    const bMatch = b.match(/\/chapter-(\d+)-/);

    const aNum = aMatch ? Number(aMatch[1]) : Number.MAX_SAFE_INTEGER;
    const bNum = bMatch ? Number(bMatch[1]) : Number.MAX_SAFE_INTEGER;

    return aNum - bNum;
  });
}

function extractTextBlocks($element: cheerio.Cheerio<any>): string[] {
  const tagName = $element.get(0)?.tagName?.toLowerCase();

  if (!tagName) return [];

  if (tagName === "ul" || tagName === "ol") {
    return $element
      .find("li")
      .toArray()
      .map((li) => cleanLine($element.constructor(li).text()))
      .filter(Boolean)
      .map((item) => `• ${item}`);
  }

  if (tagName === "table") {
    return [];
  }

  const text = cleanLine($element.text());
  return text ? [text] : [];
}

export function parseChapterPage(
  html: string,
  sourceUrl: string,
): ParsedStandingOrder[] {
  const $ = cheerio.load(html);
  const { chapterNumber, chapterTitle } = parseChapterMeta($);

  let contentRoot = $('#main-content .main[role="main"] .body-text').first();

  if (!contentRoot.length) {
    contentRoot = $('#main-content .main[role="main"]').first();
  }

  if (!contentRoot.length) {
    throw new Error(
      `Could not find standing orders content root for ${sourceUrl}`,
    );
  }

  const elements = contentRoot.find("h2,h3,h4,h5,h6,p,ul,ol,table").toArray();

  let currentPartHeading: string | null = null;
  let currentOrderNumber: string | null = null;
  let currentOrderHeading: string | null = null;
  let currentOrderLines: string[] = [];

  const orders: ParsedStandingOrder[] = [];

  function flushCurrentOrder() {
    if (!currentOrderNumber) return;

    const cleanedLines = currentOrderLines.map(cleanLine).filter(Boolean);
    const content = cleanedLines.join("\n\n");

    orders.push({
      orderNumber: currentOrderNumber,
      orderLabel: `SO ${currentOrderNumber}`,
      chapterNumber,
      chapterTitle,
      partHeading: currentPartHeading,
      heading: currentOrderHeading,
      path: dedupePath([
        `Chapter ${chapterNumber}`,
        chapterTitle,
        currentPartHeading,
        `SO ${currentOrderNumber}`,
        currentOrderHeading,
      ]),
      content,
      contentMarkdown: content,
      sourceUrl,
      sourceAnchor: `so-${currentOrderNumber.toLowerCase()}`,
      metadata: {
        orderNumber: currentOrderNumber,
        orderNumberRaw: currentOrderNumber,
        chapterNumber,
        chapterTitle,
        partHeading: currentPartHeading,
      },
    });

    currentOrderNumber = null;
    currentOrderHeading = null;
    currentOrderLines = [];
  }

  for (const element of elements) {
    const $element = $(element);
    const tagName = element.tagName.toLowerCase();
    const text = cleanLine($element.text());

    if (!text) continue;
    if (/^Originally published:/i.test(text)) continue;
    if (/^Share$/i.test(text)) break;

    if (
      (tagName === "h2" ||
        tagName === "h3" ||
        tagName === "h4" ||
        tagName === "h5" ||
        tagName === "h6") &&
      looksLikeAllCapsHeading(text) &&
      !/^SOs?\s/.test(text)
    ) {
      flushCurrentOrder();
      currentPartHeading = text;
      continue;
    }

    if (
      (tagName === "p" ||
        tagName === "h2" ||
        tagName === "h3" ||
        tagName === "h4" ||
        tagName === "h5" ||
        tagName === "h6") &&
      isStandingOrderStart(text)
    ) {
      const parsed = extractStandingOrderNumberAndHeading(text);

      if (parsed) {
        flushCurrentOrder();
        currentOrderNumber = parsed.orderNumber;
        currentOrderHeading = parsed.heading;
        continue;
      }
    }

    if (
      selectorExists($, '#main-content .main[role="main"] .body-text') &&
      currentOrderNumber
    ) {
      const blocks = extractTextBlocks($element);
      for (const block of blocks) {
        currentOrderLines.push(block);
      }
      continue;
    }

    if (currentOrderNumber) {
      const blocks = extractTextBlocks($element);
      for (const block of blocks) {
        currentOrderLines.push(block);
      }
    }
  }

  flushCurrentOrder();

  return orders;
}

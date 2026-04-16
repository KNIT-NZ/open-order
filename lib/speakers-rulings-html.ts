// lib/speakers-rulings-html.ts
import * as cheerio from 'cheerio'
import { chromium } from 'playwright'
import {
  cleanLine,
  dedupePath,
  isCitationLine,
  isRulingStart,
  looksLikePlainHeading,
  splitTrailingCitations
} from '@/lib/text'

export const SPEAKERS_RULINGS_INDEX_URL =
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/'

export const SPEAKERS_RULINGS_CHAPTER_URLS = [
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-1-general-provisions-and-office-holders/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-2-sittings-of-the-house/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-3-general-procedures/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-4-select-committees/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-5-legislative-procedures/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-6-financial-procedures/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-7-non-legislative-procedures/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-8-parliamentary-privilege/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-9-pecuniary-and-other-specified-interests/',
  'https://www.parliament.nz/en/pb/parliamentary-rules/speakers-rulings-2023-by-chapter/chapter-10-rulings-on-statutory-and-non-standing-orders-procedures/'
] as const

export type ParsedHtmlRuling = {
  rulingNumber: string
  chapter: string
  chapterTitle: string
  sectionHeading: string | null
  primaryHeading: string | null
  secondaryHeading: string | null
  heading: string | null
  path: string[]
  content: string
  citations: string[]
  sourceUrl: string
}

function parseChapterMeta($: cheerio.CheerioAPI): {
  chapter: string
  chapterTitle: string
} {
  const h1 = cleanLine(
    $('#main-content .main[role="main"] h1').first().text() ||
      $('h1').first().text()
  )

  const match = h1.match(/^Chapter\s+(\d+):\s*(.+)$/i)

  if (!match) {
    throw new Error(`Could not parse chapter metadata from H1: "${h1}"`)
  }

  return {
    chapter: match[1],
    chapterTitle: cleanLine(match[2])
  }
}

function extractRulingNumberAndRest(line: string): {
  rulingNumber: string
  rest: string | null
} {
  const match = cleanLine(line).match(/^(\d+\/\d+)\s+(.*)$/)

  if (match) {
    return {
      rulingNumber: match[1],
      rest: match[2] ? cleanLine(match[2]) : null
    }
  }

  return {
    rulingNumber: cleanLine(line),
    rest: null
  }
}

export async function fetchHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#main-content .main[role="main"] h1', {
      timeout: 60000
    })

    return await page.content()
  } finally {
    await page.close()
    await browser.close()
  }
}

export function extractChapterUrls(_indexHtml: string): string[] {
  return [...SPEAKERS_RULINGS_CHAPTER_URLS]
}

export function parseChapterPage(html: string, sourceUrl: string): ParsedHtmlRuling[] {
  const $ = cheerio.load(html)
  const { chapter, chapterTitle } = parseChapterMeta($)

  const contentRoot = $('#main-content .main[role="main"] .body-text').first()

  if (!contentRoot.length) {
    throw new Error(`Could not find rulings content root for ${sourceUrl}`)
  }

  const elements = contentRoot.find('h4,h5,p,ul,ol,li').toArray()

  let currentSectionHeading: string | null = null
  let currentPrimaryHeading: string | null = null
  let currentSecondaryHeading: string | null = null

  let currentRulingNumber: string | null = null
  let currentRulingLines: string[] = []

  const rulings: ParsedHtmlRuling[] = []

  function currentHeading(): string | null {
    return currentSecondaryHeading ?? currentPrimaryHeading ?? currentSectionHeading
  }

  function flushCurrentRuling() {
    if (!currentRulingNumber) return

    const trimmed = currentRulingLines.map(cleanLine).filter(Boolean)

    if (trimmed.length === 0) {
      currentRulingNumber = null
      currentRulingLines = []
      return
    }

    const { bodyLines, citationLines } = splitTrailingCitations(trimmed)

    rulings.push({
      rulingNumber: currentRulingNumber,
      chapter,
      chapterTitle,
      sectionHeading: currentSectionHeading,
      primaryHeading: currentPrimaryHeading,
      secondaryHeading: currentSecondaryHeading,
      heading: currentHeading(),
      path: dedupePath([
        `Chapter ${chapter}`,
        chapterTitle,
        currentSectionHeading,
        currentPrimaryHeading,
        currentSecondaryHeading
      ]),
      content: bodyLines.join('\n'),
      citations: citationLines,
      sourceUrl
    })

    currentRulingNumber = null
    currentRulingLines = []
  }

  for (const element of elements) {
    const tagName = element.tagName.toLowerCase()
    const text = cleanLine($(element).text())

    if (!text) continue
    if (/^Originally published:/i.test(text)) continue
    if (/^Share$/i.test(text)) break

    if (tagName === 'h4') {
      flushCurrentRuling()
      currentSectionHeading = text
      currentPrimaryHeading = null
      currentSecondaryHeading = null
      continue
    }

    if (tagName === 'h5') {
      flushCurrentRuling()

      if (looksLikePlainHeading(text)) {
        currentPrimaryHeading = text
        currentSecondaryHeading = null
      }

      continue
    }

    if (tagName === 'p' && isRulingStart(text)) {
      flushCurrentRuling()
      const parsed = extractRulingNumberAndRest(text)
      currentRulingNumber = parsed.rulingNumber
      currentRulingLines = parsed.rest ? [parsed.rest] : []
      continue
    }

    if ((tagName === 'ul' || tagName === 'ol') && currentRulingNumber) {
      const items = $(element)
        .find('li')
        .toArray()
        .map((li) => cleanLine($(li).text()))
        .filter(Boolean)

      for (const item of items) {
        currentRulingLines.push(`• ${item}`)
      }

      continue
    }

    if (tagName === 'li') {
      continue
    }

    if (tagName === 'p' && looksLikePlainHeading(text) && !isCitationLine(text)) {
      flushCurrentRuling()
      currentSecondaryHeading = text
      continue
    }

    if (currentRulingNumber) {
      currentRulingLines.push(text)
    }
  }

  flushCurrentRuling()

  return rulings
}
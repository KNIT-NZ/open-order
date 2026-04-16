// lib/text.ts
export function normalizePdfText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/V ol\./g, 'Vol.')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .trim()
}

export function cleanLine(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

export function isLikelyPageNoise(line: string): boolean {
  if (!line) return true
  if (/^\d+\s*$/.test(line)) return true
  if (/^SOs?\s+[\d–-]+/.test(line)) return true
  if (/^CHAPTER \d+/.test(line)) return true
  if (/^CHAPTER \d+[A-Z ]+$/.test(line)) return true
  return false
}

export function isRulingStart(line: string): boolean {
  return /^\d+\/\d+\b/.test(line)
}

export function isStandingOrderStart(line: string): boolean {
  return /^\d+[A-Z]?\s+\S/.test(cleanLine(line))
}

export function extractStandingOrderNumberAndHeading(line: string): {
  orderNumber: string
  heading: string | null
} | null {
  const match = cleanLine(line).match(/^(\d+[A-Z]?)\s+(.*)$/)

  if (!match) {
    return null
  }

  return {
    orderNumber: match[1],
    heading: match[2] ? cleanLine(match[2]) : null
  }
}

export function isCitationLine(line: string): boolean {
  return (
    /^\(?\d+\)?\s{0,4}\d{4},\s*Vol\./.test(line) ||
    /^\d{4},\s*Vol\./.test(line) ||
    /^Report of /.test(line) ||
    /^Question of privilege /.test(line) ||
    /^Final report of /.test(line)
  )
}

export function splitTrailingCitations(lines: string[]): {
  bodyLines: string[]
  citationLines: string[]
} {
  const bodyLines = [...lines]
  const citationLines: string[] = []

  while (bodyLines.length > 0) {
    const last = cleanLine(bodyLines[bodyLines.length - 1] ?? '')
    if (!last) {
      bodyLines.pop()
      continue
    }
    if (isCitationLine(last)) {
      citationLines.unshift(last)
      bodyLines.pop()
      continue
    }
    break
  }

  return { bodyLines, citationLines }
}

export function looksLikePlainHeading(input: string): boolean {
  const text = cleanLine(input)

  if (!text) return false
  if (isCitationLine(text)) return false
  if (isRulingStart(text)) return false
  if (isStandingOrderStart(text)) return false
  if (/^Originally published:/.test(text)) return false
  if (/^Sort by:/.test(text)) return false
  if (/^Also in this section:/.test(text)) return false
  if (text.length > 100) return false

  return /^[A-Z][A-Za-z’'()[\]\-,:;&/ ]+$/.test(text)
}

export function looksLikeAllCapsHeading(input: string): boolean {
  const text = cleanLine(input)

  if (!text) return false
  if (isCitationLine(text)) return false
  if (isRulingStart(text)) return false
  if (isStandingOrderStart(text)) return false
  if (/^Originally published:/.test(text)) return false
  if (/^Sort by:/.test(text)) return false
  if (/^Also in this section:/.test(text)) return false
  if (text.length > 120) return false

  return /^[A-Z][A-Z0-9 '"’()\-,:;&/]+$/.test(text)
}

export function dedupePath(parts: Array<string | null | undefined>): string[] {
  const output: string[] = []

  for (const part of parts) {
    const cleaned = cleanLine(part ?? '')
    if (!cleaned) continue
    if (output[output.length - 1] === cleaned) continue
    output.push(cleaned)
  }

  return output
}
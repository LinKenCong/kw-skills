#!/usr/bin/env node

/**
 * Style Validation Script (requires Puppeteer >= 22)
 *
 * Compares computed styles between a golden reference HTML file and a target
 * implementation (local file or dev server URL). Uses Puppeteer to open both
 * in headless Chrome, extracts visible text nodes, matches them semantically
 * (with positional tiebreaking for duplicate text), and reports style differences.
 *
 * @example
 *   node validate.mjs --reference ./reference.html --target http://localhost:5173
 *   node validate.mjs --reference ./reference.html --target ./dist/index.html --threshold 90
 *   node validate.mjs --reference ./ref.html --target http://localhost:3000 --json
 */

import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const STYLE_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'color', 'backgroundColor',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'borderRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'width', 'height',
]

const DIMENSION_PROPERTIES = new Set([
  'fontSize', 'fontWeight', 'letterSpacing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'borderRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'width', 'height',
])

const COLOR_PROPERTIES = new Set([
  'color', 'backgroundColor',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
])

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      reference: { type: 'string', short: 'r' },
      target: { type: 'string', short: 't' },
      threshold: { type: 'string', default: '95' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help || !values.reference || !values.target) {
    console.log(`Usage: node validate.mjs --reference <html-file> --target <url-or-file> [--threshold 95] [--json]

Options:
  --reference, -r   Path to golden reference HTML file (required)
  --target, -t      URL or path to target implementation (required)
  --threshold       Pass rate percentage, 0-100 (default: 95)
  --json            Output JSON only (no human-readable text)
  --help, -h        Show this help message`)
    process.exit(values.help ? 0 : 1)
  }

  const threshold = parseInt(values.threshold, 10)
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
    console.error('Error: --threshold must be a number between 0 and 100')
    process.exit(1)
  }

  return {
    referencePath: values.reference,
    targetPath: values.target,
    threshold,
    jsonOnly: values.json,
  }
}

function isUrl(pathOrUrl) {
  return pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
}

function toFileUrl(filePath) {
  return `file://${resolve(filePath)}`
}

function resolveUrl(pathOrUrl) {
  return isUrl(pathOrUrl) ? pathOrUrl : toFileUrl(pathOrUrl)
}

function normalizeText(text) {
  return text
    .replace(/[\u200B\uFEFF\u200C\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parsePxValue(value) {
  if (!value || value === 'auto' || value === 'none') return null
  if (value === 'normal') return null
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/)
  return match ? parseFloat(match[1]) : null
}

/**
 * Parse rgb()/rgba() color strings into {r, g, b, a} object.
 * Handles: rgb(R, G, B), rgba(R, G, B, A), rgb(R G B), rgb(R G B / A)
 */
function parseColor(colorStr) {
  if (!colorStr) return null

  const rgbaMatch = colorStr.match(
    /rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)\s*(?:[,/]\s*([\d.]+))?\s*\)/
  )
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10),
      g: parseInt(rgbaMatch[2], 10),
      b: parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    }
  }

  if (colorStr === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  return null
}

function colorsMatch(refColor, targetColor) {
  const refParsed = parseColor(refColor)
  const targetParsed = parseColor(targetColor)

  if (!refParsed && !targetParsed) return true
  if (!refParsed || !targetParsed) return false

  if (refParsed.a === 0 && targetParsed.a === 0) return true

  return (
    refParsed.r === targetParsed.r &&
    refParsed.g === targetParsed.g &&
    refParsed.b === targetParsed.b &&
    Math.abs(refParsed.a - targetParsed.a) < 0.01
  )
}

function isWithinTolerance(referenceValue, targetValue, tolerancePx = 1) {
  const refPx = parsePxValue(referenceValue)
  const targetPx = parsePxValue(targetValue)

  if (refPx !== null && targetPx !== null) {
    return Math.abs(refPx - targetPx) <= tolerancePx
  }

  return referenceValue === targetValue
}

/**
 * Compare lineHeight with special handling for "normal" keyword.
 * Browser default "normal" ≈ fontSize * 1.2
 */
function lineHeightsMatch(refValue, targetValue, refFontSize, targetFontSize) {
  const refPx = parsePxValue(refValue)
  const targetPx = parsePxValue(targetValue)

  if (refPx !== null && targetPx !== null) {
    return Math.abs(refPx - targetPx) <= 1
  }

  if (refValue === 'normal' && targetValue === 'normal') return true

  const refEffective = refValue === 'normal'
    ? (parsePxValue(refFontSize) || 16) * 1.2
    : refPx
  const targetEffective = targetValue === 'normal'
    ? (parsePxValue(targetFontSize) || 16) * 1.2
    : targetPx

  if (refEffective !== null && targetEffective !== null) {
    return Math.abs(refEffective - targetEffective) <= 1
  }

  return refValue === targetValue
}

function normalizeFontFamily(fontFamily) {
  if (!fontFamily) return ''
  const fonts = fontFamily
    .split(',')
    .map(f => f.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

  return fonts[0] || ''
}

function compareProperty(property, referenceValue, targetValue, referenceStyles, targetStyles) {
  if (property === 'fontFamily') {
    return normalizeFontFamily(referenceValue) === normalizeFontFamily(targetValue)
  }

  if (property === 'lineHeight') {
    return lineHeightsMatch(
      referenceValue, targetValue,
      referenceStyles?.fontSize, targetStyles?.fontSize
    )
  }

  if (COLOR_PROPERTIES.has(property)) {
    return colorsMatch(referenceValue, targetValue)
  }

  if (DIMENSION_PROPERTIES.has(property)) {
    return isWithinTolerance(referenceValue, targetValue, property === 'width' || property === 'height' ? 2 : 1)
  }

  return referenceValue === targetValue
}

async function extractTextNodes(page) {
  return page.evaluate((styleProperties) => {
    const results = []

    function getDeepestTextElements(element) {
      const childElements = Array.from(element.children)
      const hasChildWithText = childElements.some(
        child => child.innerText && child.innerText.trim().length > 0
      )

      if (!hasChildWithText && element.innerText && element.innerText.trim().length > 0) {
        const rect = element.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          const computed = window.getComputedStyle(element)
          const styles = {}
          for (const prop of styleProperties) {
            styles[prop] = computed.getPropertyValue(
              prop.replace(/([A-Z])/g, '-$1').toLowerCase()
            )
          }

          results.push({
            text: element.innerText.trim(),
            tagName: element.tagName.toLowerCase(),
            styles,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          })
        }
        return
      }

      for (const child of childElements) {
        getDeepestTextElements(child)
      }
    }

    getDeepestTextElements(document.body)
    return results
  }, STYLE_PROPERTIES)
}

function matchNodes(referenceNodes, targetNodes) {
  const matched = []
  const unmatchedReference = []
  const unmatchedTarget = new Set(targetNodes.map((_, i) => i))

  for (const refNode of referenceNodes) {
    const refText = normalizeText(refNode.text)
    let bestMatchIndex = -1
    let bestMatchScore = 0
    let bestDistance = Infinity

    for (let i = 0; i < targetNodes.length; i++) {
      if (!unmatchedTarget.has(i)) continue
      const targetText = normalizeText(targetNodes[i].text)
      const distance = Math.hypot(
        refNode.rect.x - targetNodes[i].rect.x,
        refNode.rect.y - targetNodes[i].rect.y
      )

      if (refText === targetText) {
        if (bestMatchScore < 1 || distance < bestDistance) {
          bestMatchIndex = i
          bestMatchScore = 1
          bestDistance = distance
        }
        continue
      }

      if (targetText.includes(refText) || refText.includes(targetText)) {
        const score = Math.min(refText.length, targetText.length) / Math.max(refText.length, targetText.length)
        if (score > 0.7 && (score > bestMatchScore || (score === bestMatchScore && distance < bestDistance))) {
          bestMatchIndex = i
          bestMatchScore = score
          bestDistance = distance
        }
      }
    }

    if (bestMatchIndex >= 0) {
      matched.push({ reference: refNode, target: targetNodes[bestMatchIndex] })
      unmatchedTarget.delete(bestMatchIndex)
    } else {
      unmatchedReference.push(refNode)
    }
  }

  const unmatchedTargetNodes = Array.from(unmatchedTarget).map(i => targetNodes[i])
  return { matched, unmatchedReference, unmatchedTarget: unmatchedTargetNodes }
}

function generateReport(matched, unmatchedReference, unmatchedTargetNodes, threshold, referenceNodeCount) {
  let totalChecks = 0
  let passedChecks = 0
  const failures = []
  const warnings = []

  if (referenceNodeCount === 0) {
    warnings.push('Reference page has no visible text nodes — validation is meaningless')
  } else if (matched.length === 0) {
    warnings.push('No nodes could be matched between reference and target — check that both pages loaded correctly')
  }

  for (const { reference, target } of matched) {
    for (const prop of STYLE_PROPERTIES) {
      const refVal = reference.styles[prop]
      const targetVal = target.styles[prop]

      if (!refVal && !targetVal) continue
      totalChecks++

      if (compareProperty(prop, refVal || '', targetVal || '', reference.styles, target.styles)) {
        passedChecks++
      } else {
        failures.push({
          text: reference.text.substring(0, 40),
          tagName: reference.tagName,
          property: prop,
          expected: refVal || '(empty)',
          actual: targetVal || '(empty)',
        })
      }
    }
  }

  const passRate = totalChecks > 0 ? (passedChecks / totalChecks * 100) : 0
  const hasWarnings = warnings.length > 0
  const passed = !hasWarnings && passRate >= threshold

  return {
    ok: passed,
    summary: {
      matchedNodes: matched.length,
      totalNodes: matched.length + unmatchedReference.length,
      totalChecks,
      passedChecks,
      failedChecks: totalChecks - passedChecks,
      passRate: Math.round(passRate * 10) / 10,
      threshold,
    },
    warnings,
    failures: failures.map(f => ({
      text: f.text,
      tag: f.tagName,
      property: f.property,
      expected: f.expected,
      actual: f.actual,
    })),
    unmatchedInReference: unmatchedReference.map(n => ({
      text: n.text.substring(0, 60),
      tag: n.tagName,
    })),
    unmatchedInTarget: unmatchedTargetNodes.map(n => ({
      text: n.text.substring(0, 60),
      tag: n.tagName,
    })),
  }
}

function printReport(report) {
  const { summary, warnings, failures, unmatchedInReference, unmatchedInTarget } = report

  console.error('\n=== Style Validation Report ===')
  console.error(`Matched nodes: ${summary.matchedNodes}/${summary.totalNodes}`)
  console.error(`Checks: ${summary.passedChecks}/${summary.totalChecks} passed`)
  console.error(`Pass rate: ${summary.passRate}% (threshold: ${summary.threshold}%)`)
  console.error(`Result: ${report.ok ? '✅ PASSED' : '❌ FAILED'}`)

  if (warnings.length > 0) {
    console.error(`\n⚠️  WARNINGS:`)
    for (const w of warnings) {
      console.error(`  ${w}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n❌ FAILED CHECKS (${failures.length}):`)
    for (const f of failures) {
      console.error(`  "${f.text}" (${f.tag})`)
      console.error(`    ${f.property}: expected "${f.expected}" got "${f.actual}"`)
    }
  }

  if (unmatchedInReference.length > 0) {
    console.error(`\n⚠️  UNMATCHED IN REFERENCE (missing from target):`)
    for (const n of unmatchedInReference) {
      console.error(`  "${n.text}" (${n.tag})`)
    }
  }

  if (unmatchedInTarget.length > 0) {
    console.error(`\n⚠️  UNMATCHED IN TARGET (extra in target):`)
    for (const n of unmatchedInTarget) {
      console.error(`  "${n.text}" (${n.tag})`)
    }
  }

  console.error('')
}

async function main() {
  const { referencePath, targetPath, threshold, jsonOnly } = parseCliArgs()

  if (!isUrl(referencePath) && !existsSync(referencePath)) {
    console.error(`Error: Reference file not found: ${referencePath}`)
    process.exit(1)
  }

  if (!isUrl(targetPath) && !existsSync(targetPath)) {
    console.error(`Error: Target file not found: ${targetPath}`)
    process.exit(1)
  }

  let puppeteer
  try {
    puppeteer = await import('puppeteer')
  } catch {
    console.error('Error: puppeteer is not installed.')
    console.error('Install it with: npm install -g puppeteer')
    console.error('Or locally:      npm install puppeteer')
    process.exit(1)
  }

  let browser
  try {
    browser = await puppeteer.default.launch({ headless: true })
  } catch (launchError) {
    console.error('Failed to launch headless Chrome. Ensure Chromium is installed.')
    console.error('Try: npx puppeteer browsers install chrome')
    console.error('Detail:', launchError.message)
    process.exit(1)
  }

  try {
    const referenceUrl = resolveUrl(referencePath)
    const targetUrl = resolveUrl(targetPath)

    const [referencePage, targetPage] = await Promise.all([
      browser.newPage(),
      browser.newPage(),
    ])

    await Promise.all([
      referencePage.setViewport({ width: 1280, height: 900 }),
      targetPage.setViewport({ width: 1280, height: 900 }),
    ])

    await Promise.all([
      referencePage.goto(referenceUrl, { waitUntil: 'networkidle0', timeout: 30000 }),
      targetPage.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 }),
    ])

    const [referenceNodes, targetNodes] = await Promise.all([
      extractTextNodes(referencePage),
      extractTextNodes(targetPage),
    ])

    const { matched, unmatchedReference, unmatchedTarget: unmatchedTargetNodes } = matchNodes(referenceNodes, targetNodes)
    const report = generateReport(matched, unmatchedReference, unmatchedTargetNodes, threshold, referenceNodes.length)

    if (!jsonOnly) {
      printReport(report)
    }
    console.log(JSON.stringify(report))

    return report.ok ? 0 : 1

  } finally {
    await browser.close().catch(() => {})
  }
}

main()
  .then(exitCode => process.exit(exitCode))
  .catch(err => {
    console.error('Validation failed:', err.message)
    process.exit(1)
  })

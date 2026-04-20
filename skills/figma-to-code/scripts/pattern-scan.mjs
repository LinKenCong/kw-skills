#!/usr/bin/env node

/**
 * Static pattern scanner for golden-reference HTML files.
 *
 * Detects known failure patterns from coding-guide.md Section 6 that can be
 * identified by static analysis (regex/string matching on HTML source).
 * Outputs structured JSON with detected patterns and fix instructions.
 *
 * @example
 *   node pattern-scan.mjs --html golden-reference.html
 *   node pattern-scan.mjs --html golden-reference.html --json
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      html: { type: 'string', short: 'h' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(`Usage: pattern-scan.mjs --html <html-file> [--json]

Options:
  --html, -h   Path to the golden reference HTML file
  --json       Output result as JSON only
  --help       Show this help`);
    process.exit(0);
  }

  if (!values.html) {
    console.error('Error: --html is required');
    process.exit(1);
  }

  return {
    htmlPath: resolve(values.html),
    jsonOutput: !!values.json,
  };
}

/**
 * Pre-compute nesting depth for each line.
 * Counts opening/closing tags of block-level elements to determine depth.
 * Returns an array where depthMap[i] is the nesting depth at line i.
 */
function computeDepthMap(htmlLines) {
  const depthMap = [];
  let depth = 0;
  for (let i = 0; i < htmlLines.length; i++) {
    const line = htmlLines[i];
    const opens = (line.match(/<(?:div|section|main|article|header|footer|nav|aside)[\s>]/gi) || []).length;
    const closes = (line.match(/<\/(?:div|section|main|article|header|footer|nav|aside)>/gi) || []).length;
    depthMap[i] = depth;
    depth += opens - closes;
  }
  return depthMap;
}

const PATTERNS = [
  {
    id: 'fixed-width-container',
    name: 'Outer container uses fixed width instead of max-width',
    severity: 'high',
    fixInstruction: 'Change fixed `width: Npx` to `width: 100%; max-width: Npx` on the outer container.',
    detect(htmlLines, depthMap) {
      const findings = [];
      const widthRegex = /width:\s*(\d{3,})px/g;

      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        let match;
        while ((match = widthRegex.exec(line)) !== null) {
          if (line.includes('max-width')) continue;
          if (depthMap[i] > 1) continue;
          const widthValue = match[1];
          findings.push({
            line: i + 1,
            context: line.trim().substring(0, 120),
            widthValue,
          });
        }
        widthRegex.lastIndex = 0;
      }

      return findings;
    },
  },

  {
    id: 'flex1-missing-min-width',
    name: 'flex: 1 without min-width: 0 in flex-row context',
    severity: 'high',
    fixInstruction: 'Add `min-width: 0` (or Tailwind `min-w-0`) alongside every `flex: 1` / `flex-1` in a flex-row parent.',
    detect(htmlLines) {
      const findings = [];
      const flexRegex = /(?:flex:\s*1(?:\s|;|"|$))|(?:class="[^"]*\bflex-1\b[^"]*")/;

      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        if (flexRegex.test(line) &&
            !line.includes('min-width: 0') && !line.includes('min-w-0')) {
          findings.push({
            line: i + 1,
            context: line.trim().substring(0, 120),
          });
        }
      }

      return findings;
    },
  },

  {
    id: 'fixed-width-no-shrink',
    name: 'Fixed-width flex child missing flex-shrink: 0',
    severity: 'medium',
    fixInstruction: 'Add `flex-shrink: 0` (or Tailwind `shrink-0`) to fixed-width elements inside a flex-row parent.',
    detect(htmlLines) {
      const findings = [];
      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        const hasFixedWidth = /width:\s*\d+px/.test(line) || /w-\[\d+px\]/.test(line);
        const hasShrink = line.includes('flex-shrink: 0') || line.includes('shrink-0');

        if (hasFixedWidth && !hasShrink) {
          const parentLines = htmlLines.slice(Math.max(0, i - 5), i);
          const inFlexRow = parentLines.some(l =>
            l.includes('display: flex') || l.includes('flex-row') || /class="[^"]*\bflex\b[^"]*"/.test(l)
          );
          if (inFlexRow) {
            findings.push({
              line: i + 1,
              context: line.trim().substring(0, 120),
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'large-font-no-clamp',
    name: 'Large font-size (>60px) without clamp() for responsive scaling',
    severity: 'medium',
    fixInstruction: 'Use `clamp(minpx, Nvw, maxpx)` instead of a fixed font-size > 60px for responsive scaling.',
    detect(htmlLines) {
      const findings = [];
      const fontRegex = /font-size:\s*(\d+)px/g;

      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        let match;
        while ((match = fontRegex.exec(line)) !== null) {
          if (parseInt(match[1], 10) > 60 && !line.includes('clamp(')) {
            findings.push({
              line: i + 1,
              context: line.trim().substring(0, 120),
            });
          }
        }
        fontRegex.lastIndex = 0;
      }

      return findings;
    },
  },

  {
    id: 'fixed-height-no-min-height',
    name: 'Fixed height without min-height alternative',
    severity: 'medium',
    fixInstruction: 'Consider using `min-height` instead of fixed `height` for sections that may contain wrapping text.',
    detect(htmlLines) {
      const findings = [];
      const heightRegex = /(?:^|[; "])height:\s*(\d+)px/;

      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        if (heightRegex.test(line) && !line.includes('min-height') && !line.includes('max-height') && !line.includes('min-h-')) {
          const match = line.match(/height:\s*(\d+)px/);
          if (match && parseInt(match[1], 10) > 200) {
            findings.push({
              line: i + 1,
              context: line.trim().substring(0, 120),
            });
          }
        }
      }

      return findings;
    },
  },

  {
    id: 'rgba-instead-of-hex',
    name: 'Using rgba() format instead of hex colors',
    severity: 'low',
    fixInstruction: 'Convert `rgba()/rgb()` colors to hex format to match Figma extraction data.',
    detect(htmlLines) {
      const findings = [];
      const rgbaRegex = /rgba?\(\s*\d+/;

      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        if (rgbaRegex.test(line)) {
          findings.push({
            line: i + 1,
            context: line.trim().substring(0, 120),
          });
        }
      }

      return findings;
    },
  },

  {
    id: 'google-fonts-malformed',
    name: 'Google Fonts link may be misconfigured',
    severity: 'medium',
    fixInstruction: 'Ensure Google Fonts URL includes `&display=swap` parameter and font family names match exactly.',
    detect(htmlLines) {
      const findings = [];
      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        if (line.includes('fonts.googleapis.com') || line.includes('fonts.gstatic.com')) {
          if (!line.includes('display=swap')) {
            findings.push({
              line: i + 1,
              context: line.trim().substring(0, 120),
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'margin-gap-conflict',
    name: 'Mixed margin and gap spacing on same container',
    severity: 'low',
    fixInstruction: 'Use `gap` for sibling spacing and `padding` for container internal spacing. Avoid mixing `margin` and `gap` on the same container.',
    detect(htmlLines) {
      const findings = [];
      for (let i = 0; i < htmlLines.length; i++) {
        const line = htmlLines[i];
        const hasGap = line.includes('gap:') || /class="[^"]*gap-/.test(line);
        const hasMargin = /margin(?:-top|-bottom|-left|-right)?:/.test(line) ||
                          /class="[^"]*m[trblxy]-/.test(line);

        if (hasGap && hasMargin) {
          findings.push({
            line: i + 1,
            context: line.trim().substring(0, 120),
          });
        }
      }
      return findings;
    },
  },
];

function scanHtml(htmlPath) {
  const html = readFileSync(htmlPath, 'utf-8');
  const htmlLines = html.split('\n');
  const depthMap = computeDepthMap(htmlLines);

  const detectedPatterns = [];

  for (const pattern of PATTERNS) {
    const locations = pattern.detect(htmlLines, depthMap);
    if (locations.length > 0) {
      let fixText = pattern.fixInstruction;
      if (pattern.id === 'fixed-width-container' && locations[0].widthValue) {
        const widthValue = locations[0].widthValue;
        fixText = `Change \`width: ${widthValue}px\` to \`width: 100%; max-width: ${widthValue}px\` on the outer container.`;
      }
      detectedPatterns.push({
        id: pattern.id,
        name: pattern.name,
        severity: pattern.severity,
        locations,
        fix: fixText,
      });
    }
  }

  return { patterns: detectedPatterns };
}

function main() {
  const args = parseCliArgs();

  if (!existsSync(args.htmlPath)) {
    console.error(`HTML file not found: ${args.htmlPath}`);
    process.exit(1);
  }

  const result = scanHtml(args.htmlPath);

  if (args.jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.patterns.length === 0) {
      console.log('No known failure patterns detected.');
    } else {
      console.log(`Detected ${result.patterns.length} pattern(s):\n`);
      for (const p of result.patterns) {
        console.log(`[${p.severity.toUpperCase()}] ${p.name}`);
        for (const loc of p.locations) {
          console.log(`  Line ${loc.line}: ${loc.context}`);
        }
        console.log(`  Fix: ${p.fix}\n`);
      }
    }
  }
}

main();

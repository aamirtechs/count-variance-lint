# Count Variance Lint
Live page: https://aamirtechs.github.io/count-variance-lint/

Cycle counts produce a spreadsheet nobody prioritises, and shrinkage hides in lines that look small. Count Variance Lint compares system stock against counted stock on a strict SKU + location key, ranks every variance by money impact, and hands you a recount sheet for the worst offenders first.

## Features
- Two CSVs (system stock and counted stock), or one CSV with both quantity columns
- Matching on a composite SKU + location key with duplicate-key warnings
- Variance units and variance value per line, ranked by absolute value impact
- Threshold flags for lines over a variance percent or value limit
- Recount sheet (top N) and full variance report as CSV downloads

## How it works
Paste or type the system and counted CSVs, set a flag threshold, and run the comparison. Lines are matched on SKU plus location, duplicates are called out instead of silently merged, and results are sorted by value impact with CSV downloads for the full report and the recount sheet. It runs entirely in the browser.

## Privacy
Runs 100% in your browser. Your files never leave this device, nothing is uploaded,
and there is no tracking.

## Development
Core logic lives in `src/logic.js` and is shared by the page and the tests.
Run the tests with `npm test`.

## License
MIT, Copyright 2026 Amir Hussain.

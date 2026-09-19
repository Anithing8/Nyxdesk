# Nyxdesk

A free, open-source set of document tools that run entirely in your browser. Nyxdesk has five tools — **Docs**, **Sheets**, **Slides**, **Notes**, and **PDF** — that open, edit, and save documents in common file formats. There's no backend, no account, and no upload: every file you work with is read and written locally in JavaScript.

> **Scope, honestly stated:** this project does not reimplement every feature of a large commercial office suite — that's a multi-decade undertaking involving hundreds of engineers, and no honest open-source project can claim to match it in full. What's here is a genuinely working set of five tools covering the parts of that job people reach for most: writing, spreadsheets with real formulas, slides, quick notes, and PDF markup — each with real import/export to a standard file format. The [Roadmap](#roadmap) lists what isn't built yet. Pull requests welcome.

## Features

### Docs (`docs.html`)
- Rich text editing: headings, font family/size, bold/italic/underline/strike, colors, ordered/bullet/checklist lists, indentation, alignment, sub/superscript, blockquotes, code blocks, links, and images.
- Find &amp; replace.
- A simple table insert (as an editable, tab-aligned text grid — see Roadmap for native tables).
- Open `.docx`, `.html`, or `.txt`. Save as `.docx`, `.html`, or `.txt`.
- Print or "Save as PDF" via the browser's native print dialog.
- Autosaves locally as you type.

### Sheets (`sheets.html`)
- A grid (60 rows × 20 columns) with a formula bar and keyboard navigation.
- Multiple sheets per workbook, with tabs to add, rename, and delete them.
- Per-cell formatting: bold, italic, text color, fill color.
- Column sorting (ascending/descending).
- Formulas: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `IFERROR`, `AND`, `OR`, `NOT`, `ROUND`, `ABS`, `SQRT`, `POWER`, `CONCAT`/`CONCATENATE`, `TRIM`, `UPPER`, `LOWER`, `LEN`, `SUMIF`, `COUNTIF`, `TODAY`, `NOW` — cell references (`A1`) and ranges (`A1:A10`) work within the active sheet.
- Open `.xlsx` or `.csv` (multi-sheet `.xlsx` files import as separate tabs). Save as `.xlsx` or `.csv`.

### Slides (`slides.html`)
- A free-form canvas per slide: text boxes, images, rectangles, and ovals — drag to move, drag the corner handle to resize.
- Multiple slides with a thumbnail rail: add, switch, duplicate, or delete.
- Per-slide speaker notes (carried into the exported file).
- Full-screen presenter mode with keyboard and click navigation.
- Export to `.pptx`. Importing `.pptx` currently pulls in **text only** — see Roadmap.

### Notes (`notes.html`)
- A searchable list of quick notes with the same rich-text formatting as Docs.
- Autosaves per note as you type; search filters by title and content.
- Export the open note as `.txt`, or print/save as PDF.

### PDF (`pdf.html`)
- Open any PDF and view it page by page, or start from a new blank PDF.
- Mark it up: add text boxes, highlight, draw a rectangle, or draw freehand (useful as a quick signature).
- Page operations: rotate, delete, or append a blank page.
- Save the result as a new, edited `.pdf` — the original file is never modified in place.
- Page reordering, multi-file merging, and form-field filling aren't built yet — see Roadmap.

All five tools autosave locally as you work, so a refresh won't lose your place. Nothing syncs between devices or browsers, since nothing leaves the browser in the first place.

## Getting started

Nyxdesk is plain HTML, CSS, and JavaScript — no build step, no `npm install`, no framework compiler. It loads a handful of open-source libraries from public CDNs (Quill, Mammoth, html-docx-js, SheetJS, JSZip, PptxGenJS, PDF.js, pdf-lib) for the file-format work.

### Run it locally
Because browsers restrict some features (like file APIs) on the `file://` protocol, serve the folder instead of opening the HTML files directly:

```bash
git clone https://github.com/<your-username>/nyxdesk.git
cd nyxdesk
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, VS Code's Live Server extension, etc.).

### Host it for free on GitHub Pages
1. Push this project to a GitHub repository.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch," pick your default branch and the `/ (root)` folder.
4. Save. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/` within a minute or two.

No server, database, or paid tier required.

## Project structure

```
nyxdesk/
├── index.html         # landing page
├── docs.html           # word processor
├── sheets.html         # spreadsheet
├── slides.html         # presentation editor
├── notes.html          # quick notes
├── pdf.html            # PDF viewer / editor
├── favicon.svg
├── css/
│   └── style.css        # shared design system (tokens, top bar, menus, mobile drawer)
└── js/
    ├── theme.js          # light/dark toggle, toast, download helper, mobile drawer wiring
    ├── docs.js           # Quill setup, find & replace, .docx import/export
    ├── sheets.js          # multi-sheet grid, formula engine, formatting, .xlsx/.csv import/export
    ├── slides.js          # canvas editor, present mode, .pptx import/export
    ├── notes.js           # note list, search, autosave
    └── pdf.js             # PDF.js rendering, annotation tools, pdf-lib export
```

## Roadmap

- [ ] Cross-sheet formula references and simple charts in Sheets.
- [ ] Native tables in Docs (the current table insert is a plain-text grid fallback).
- [ ] Layout- and image-preserving import for PDF and Slides (currently text-only on import).
- [ ] Page reordering and multi-file merging in the PDF tool; PDF form-field filling.
- [ ] Slide transitions beyond the default cut.
- [ ] Offline support via a service worker.
- [ ] Optional peer-to-peer sync for people who want it — still no required server.

Contributions against any of these — or anything else — are welcome. Open an issue first for larger changes so we can talk through the approach.

## Third-party libraries

Nyxdesk doesn't reimplement file-format parsing from scratch; it stands on these open-source projects, loaded from public CDNs:

| Library | Used for | License |
|---|---|---|
| [Quill](https://quilljs.com/) | Rich text editing in Docs and Notes | BSD-3-Clause |
| [Mammoth.js](https://github.com/mwilliamson/mammoth.js) | Reading `.docx` files | BSD-2-Clause |
| [html-docx-js](https://github.com/evidenceprime/html-docx-js) | Writing `.docx` files | MIT |
| [SheetJS (xlsx)](https://sheetjs.com/) | Reading/writing `.xlsx`/`.csv` | Apache-2.0 |
| [JSZip](https://stuk.github.io/jszip/) | Reading `.pptx` archives | MIT/GPLv3 |
| [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) | Writing `.pptx` files | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Rendering PDF pages | Apache-2.0 |
| [pdf-lib](https://pdf-lib.js.org/) | Editing and writing PDF files | MIT |
| [Inter](https://rsms.me/inter/) & [Fraunces](https://github.com/undercasetype/Fraunces) | Typefaces, via Google Fonts | OFL |

## A note on trademarks

Nyxdesk is an independent, community project. It is **not affiliated with, sponsored by, or endorsed by** any office-software vendor. It doesn't use any vendor's product names, logos, icon sets, or color schemes — "Docs," "Sheets," "Slides," "Notes," and "PDF" here are plain descriptive names for what each tool does ("PDF" itself is a generic, open file-format name, not a trademark). Nyxdesk reads and writes files compatible with widely used, openly documented office file formats for interoperability, which is a well-established fair use for independent software; it does not claim any trademark rights over those formats. If you fork this project, please keep it that way — no vendor branding, no claims of official affiliation.

## License

MIT — see [`LICENSE`](LICENSE). Do what you like with it; keep the license notice.

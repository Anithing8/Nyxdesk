# Nyxdesk

A free, open-source office suite that runs entirely in your browser. Nyxdesk has three tools — **Docs**, **Sheets**, and **Slides** — that open, edit, and save documents in common office file formats. There's no backend, no account, and no upload: every file you work with is read and written locally in JavaScript.

**Live demo:** enable GitHub Pages on this repo (see below) and it'll be free to host and share.

> **Honest scope note:** replicating every feature of a decades-old, multi-billion-dollar office suite in a static site isn't realistic, and this project doesn't claim to. What it does provide is a genuinely working core: rich-text documents, a formula-capable spreadsheet grid, and a slide editor with present mode — each with real import/export to a common file format. See [Roadmap](#roadmap) for what's next, and pull requests are very welcome.

## Features

### Docs (`docs.html`)
- Rich text editing: headings, bold/italic/underline/strike, colors, lists, indentation, alignment, blockquotes, code blocks, links, and images.
- Open `.docx`, `.html`, or `.txt` files.
- Save as `.docx`, `.html`, or `.txt`.
- Print or "Save as PDF" using the browser's native print dialog.
- Autosaves to your browser's local storage as you type.

### Sheets (`sheets.html`)
- A spreadsheet grid (60 rows × 20 columns) with a formula bar.
- Formulas: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, cell references (`A1`), ranges (`A1:A10`), and arithmetic (`=B2*1.08`).
- Keyboard navigation (arrows, Tab, Enter).
- Open `.xlsx` or `.csv`. Save as `.xlsx` or `.csv`.

### Slides (`slides.html`)
- A free-form canvas per slide: add text boxes, images, and rectangles; drag to move, drag the corner handle to resize.
- Multiple slides with a thumbnail rail — add, reorder by clicking, delete.
- Full-screen presenter mode with keyboard navigation.
- Export to `.pptx` (opens in any presentation software that reads the standard PowerPoint XML format).
- Importing `.pptx` currently pulls in the **text only** — layouts and images aren't preserved yet (see Roadmap).

All three tools autosave locally as you work, so a refresh won't lose your place.

## Getting started

Nyxdesk is plain HTML, CSS, and JavaScript — no build step, no `npm install`, no framework compiler. It loads a handful of open-source libraries from public CDNs (Quill, Mammoth, html-docx-js, SheetJS, JSZip, PptxGenJS) for the file-format work.

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
├── index.html        # landing page
├── docs.html          # word processor
├── sheets.html        # spreadsheet
├── slides.html        # presentation editor
├── favicon.svg
├── css/
│   └── style.css      # shared design system (tokens, top bar, buttons, menus)
└── js/
    ├── theme.js        # light/dark toggle, toast, download helper (shared)
    ├── docs.js         # Quill setup, .docx import/export
    ├── sheets.js        # grid, formula engine, .xlsx/.csv import/export
    └── slides.js        # canvas editor, present mode, .pptx import/export
```

## Roadmap

- [ ] Preserve formulas (not just values) on spreadsheet import.
- [ ] Multi-sheet workbooks.
- [ ] Slide import that keeps layout, images, and formatting, not just text.
- [ ] Slide transitions and speaker notes.
- [ ] Tables in Docs.
- [ ] Optional real-time collaboration via WebRTC or a self-hosted sync server (still no required backend).
- [ ] Offline support via a service worker.

Contributions against any of these — or anything else — are welcome. Open an issue first for larger changes so we can talk through the approach.

## Third-party libraries

Nyxdesk doesn't reimplement file-format parsing from scratch; it stands on these open-source projects, loaded from public CDNs:

| Library | Used for | License |
|---|---|---|
| [Quill](https://quilljs.com/) | Rich text editing in Docs | BSD-3-Clause |
| [Mammoth.js](https://github.com/mwilliamson/mammoth.js) | Reading `.docx` files | BSD-2-Clause |
| [html-docx-js](https://github.com/evidenceprime/html-docx-js) | Writing `.docx` files | MIT |
| [SheetJS (xlsx)](https://sheetjs.com/) | Reading/writing `.xlsx`/`.csv` | Apache-2.0 |
| [JSZip](https://stuk.github.io/jszip/) | Reading `.pptx` archives | MIT/GPLv3 |
| [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) | Writing `.pptx` files | MIT |
| [Inter](https://rsms.me/inter/) & [Fraunces](https://github.com/undercasetype/Fraunces) | Typefaces, via Google Fonts | OFL |

## A note on trademarks

Nyxdesk is an independent, community project. It is **not affiliated with, sponsored by, or endorsed by** any office-software vendor. It doesn't use any vendor's product names, logos, icon sets, or color schemes — "Docs," "Sheets," and "Slides" here are plain descriptive names for what each tool does. Nyxdesk reads and writes files compatible with widely used, openly documented office file formats for interoperability, which is a well-established fair use for independent software; it does not claim any trademark rights over those formats. If you fork this project, please keep it that way — no vendor branding, no claims of official affiliation.

## License

MIT — see [`LICENSE`](LICENSE). Do what you like with it; keep the license notice.

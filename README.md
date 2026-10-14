# Nyxdesk

A small office suite that runs entirely in your browser: a word processor,
a spreadsheet, a presentation builder and a PDF reader/editor. There's no
server, no account, and no upload — every file you open or create stays on
your device, saved in the browser's own local storage, and files you export
download straight to your computer or phone.

**Live app:** enable GitHub Pages on this repo (Settings → Pages → Deploy
from branch → `main` / root) and it'll be served at
`https://<your-username>.github.io/<repo-name>/`.

## The four tools

| Tool | What it's for | Opens / saves |
|---|---|---|
| **Inkwell** | Documents | `.docx`, `.md`, `.html`, `.txt` |
| **Abacus** | Spreadsheets | `.xlsx`, `.csv`, `.tsv` |
| **Marquee** | Presentations | `.pptx` |
| **Parchment** | Reading, annotating and editing PDFs | `.pdf` |

### Inkwell
Rich-text formatting (fonts, sizes, colors, highlight, styles, headings),
bullet/numbered/checklist lists, tables, images, links, headers & footers,
page numbers, page breaks, margins/orientation/size/columns, watermark and
page color, a table of contents that builds itself from your headings,
footnotes, citations, captions, comments, a basic track-changes mode, find &
replace, word count, an outline view, and export to Word, Markdown, HTML,
plain text, or print to PDF.

### Abacus
A real formula engine (cell references, ranges, and 40+ functions —
`SUM`, `AVERAGE`, `IF`, `VLOOKUP`, `SUMIF`, text functions, and more),
multiple sheets, cell formatting (bold/italic/underline, fill & text color,
borders, number/currency/percent formats, alignment, wrap), sort, remove
duplicates, simple data validation, notes, inline charts (column/line/pie),
and import/export to Excel (`.xlsx`) and CSV.

### Marquee
Slide layouts, a small set of built-in themes, text boxes, images, shapes,
lines, tables, charts, icons, drag-to-position and resize, slide transitions,
speaker notes, a full-screen presenter mode with keyboard navigation, and
export to PowerPoint (`.pptx`).

### Parchment
Open and view any PDF (continuous scroll, zoom, page thumbnails, text
search), annotate it (highlight, underline, strikeout, freehand drawing,
sticky notes, text boxes, shapes, stamps), edit it (add text/images,
whiteout, genuine redaction — the redacted page is flattened to an image
on export so the covered text isn't just hidden, it's gone), manage pages
(rotate, delete, duplicate, insert blank pages, extract, merge multiple
PDFs, split into one-file-per-page), add basic form-style fields, and
export the result as a new PDF.

## What's intentionally not included

Being upfront about scope, the same way good open-source projects are:

- **No password/encryption support in Parchment.** The PDF library this project
  uses doesn't implement PDF encryption, and that's not something to fake.
- **No OCR ("make scanned pages searchable").** Real text recognition needs
  an on-device model that isn't bundled here.
- **No macros/scripting** in any app — running arbitrary recorded scripts
  safely inside a browser tab isn't realistic.
- **No mail merge, no cloud co-authoring, no "send as email" integration** —
  all of those need a mail or identity service this project deliberately
  doesn't depend on.
- **Opening `.docx` and `.xlsx` files uses a small built-in reader**, not a
  full implementation of either format, so unusual or very complex files may
  not come through perfectly. Exporting is likewise a solid, broadly
  compatible subset of each format rather than a byte-for-byte clone of
  Word/Excel/PowerPoint's own output.

None of the above is hidden or silently stubbed out — each one tells you
plainly in the app if you try to use it.

## Running it locally

It's a static site. Any static file server works:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

No build step, no `npm install` required to run the app — the few
third-party libraries it needs (for `.docx`/`.xlsx`/`.pptx`/`.pdf` file
format support) are already vendored in `/vendor` and `/js/icons.js`, so the
app has zero runtime dependency on any external CDN or network request.

## Project layout

```
index.html         Home screen / launcher
inkwell.html + js/inkwell.js + css/inkwell.css     Word processor
abacus.html  + js/abacus.js  + css/abacus.css      Spreadsheet
marquee.html + js/marquee.js + css/marquee.css    Presentations
parchment.html + js/parchment.js + css/parchment.css   PDF tool
js/core.js          Shared runtime: theme, dialogs, menus, local storage, autosave
js/icons.js         Generated icon set (see NOTICE.md)
css/base.css         Shared design tokens and app chrome
vendor/              Vendored third-party libraries (see NOTICE.md)
manifest.webmanifest, sw.js    Installable app + offline support
```

## Privacy

Everything runs client-side. Files are kept in the browser's IndexedDB,
scoped to this site's origin — nothing is transmitted anywhere. There's no
analytics, no tracking, and no ads. Clearing your browser's site data (or
opening the app in a different browser or device) means your saved files
won't be there, so use a tool's **Export** option for anything you want to
keep long-term.

## License

Nyxdesk's own code is released under the [MIT License](LICENSE). It uses a
handful of open-source libraries for file-format support — see
[NOTICE.md](NOTICE.md) for the full list and their licenses.

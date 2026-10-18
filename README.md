# Nyxdesk

A small office suite that runs entirely in your browser: a word processor,
a spreadsheet, a presentation builder and a PDF reader/editor. There's no
server, no account, and no upload — every file you open or create stays on
your device, saved in the browser's own local storage, and files you export
download straight to your computer or phone.

**Live app:** enable GitHub Pages on this repo (Settings → Pages → Deploy
from branch → `main` / root) and it'll be served at
`https://github.com/Anithing8/Nyxdesk`.

## The four tools

| Tool | For | Opens | Saves |
|---|---|---|---|
| **Inkwell** | Documents | `.docx` `.md` `.txt` `.html` | `.docx` `.md` `.txt` `.html` |
| **Abacus** | Spreadsheets | `.xlsx` `.csv` `.tsv` | `.xlsx` `.csv` |
| **Marquee** | Presentations | `.pptx` | `.pptx` |
| **Parchment** | PDFs | `.pdf` | `.pdf` |

Everything autosaves to your browser's own storage and nothing is uploaded.

**Inkwell** reflows to the screen on a phone (no shrunken page). Word export includes real numbered lists, links, inline formatting, images, tables and every page.

**Abacus** has a formula engine, undo/redo, insert/delete rows and columns (formulas follow), merge, freeze, filter, data validation drop-downs, sort, de-duplicate, charts, and `.xlsx` import/export that keeps bold/italic, colours, fills, number formats, merges, column widths and frozen panes. On a phone: tap a cell to select it, tap it again to edit, or use the formula bar; switch on the pointer button to drag-select a range.

**Marquee** opens real `.pptx` files (text with formatting, shapes, pictures, tables, backgrounds, notes) and edits them by touch or mouse. Drag a text box by its grip; drag pictures and shapes anywhere.

**Parchment** renders pages lazily (long PDFs stay fast), draws and highlights with a finger, pans with the hand tool, pinch-zooms, and exports with your markup baked in.

## Using it on a phone

* **Open a file** on the home screen uses the system file picker.
* **Install it** (Chrome: *Install*; Safari: *Share → Add to Home Screen*) to run it full-screen and offline.
* On **Android Chrome**, once installed, Nyxdesk appears in the system **Share** sheet, so you can send a file to it straight from your file manager, mail or messages. (Not available on iOS — use *Open a file* there.)
* On desktop Chrome, an installed Nyxdesk can be chosen under *Open with…* for supported files.

## What's intentionally not included / known limits

* Password-protecting a PDF; moving an annotation after placing it.
* Abacus: no references between sheets, no fill-handle drag, charts are simple (column, line, pie). Imported `.xlsx` conditional formatting, pivot tables and images are dropped.
* Inkwell: Word styles, headers/footers and comments aren't round-tripped; numbered lists from an opened `.docx` come in as bullets.
* Marquee: charts, SmartArt, animations and master-slide styling in an opened `.pptx` aren't reproduced (charts show a placeholder); fonts are approximated.
* Large `.xlsx` files: up to 5,000 rows × 104 columns are shown.

## Testing

The behaviour above was exercised in headless Chromium at desktop and iPhone-sized viewports (touch events included): typing, formatting, undo, import/export round-trips of real `.docx/.xlsx/.pptx/.pdf` files, offline reload, and the share-target path. It has **not** been run on physical iOS or Android hardware, so please report anything that behaves differently in Safari.

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
js/backdrop.js      The animated WebGL backdrop on the home screen (stills if WebGL or motion is unavailable)
icons/               PNG app icons for installing
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

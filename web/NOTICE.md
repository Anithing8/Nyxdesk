# Open-source notices

Nyxdesk is original code. It uses the following open-source libraries,
vendored in `/vendor` and `/js/icons.js` so the app has no third-party
network dependency at runtime. Each is used under its own license, reproduced
or linked below.

| Library | Used for | License |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) | Rendering PDF pages in Parchment | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Creating and editing PDFs in Parchment | MIT |
| [docx](https://github.com/dolanmiu/docx) | Writing `.docx` files from Inkwell | MIT |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | Writing `.pptx` files from Marquee | MIT |
| [JSZip](https://github.com/Stuk/jszip) | Reading/writing `.docx`/`.xlsx`/`.pptx` zip containers | MIT or GPL-3.0-or-later |
| [Lucide](https://lucide.dev) icons, via [react-icons](https://github.com/react-icons/react-icons) | The icon set used throughout the UI (`js/icons.js`) | ISC (Lucide), MIT (react-icons packaging) |

Full license text for each library ships alongside it:

- `vendor/pdfjs/LICENSE` — pdf.js (Apache-2.0)
- `vendor/react-icons-LICENSE.txt` — react-icons packaging (MIT)
- pdf-lib, docx, PptxGenJS and JSZip are MIT-licensed; their permission
  notices are included in the minified bundle headers in `/vendor`.

No other third-party code, fonts, images, or services are used. Nyxdesk does
not call out to any external API, CDN, or analytics service — everything
needed to run the app ships in this repository.

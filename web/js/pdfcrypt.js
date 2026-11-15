/* Nyxdesk — PDF password protection.
   Adds a real "open password" to a PDF that pdf-lib has built, using the standard PDF security handler
   (revision 6: AES-256, the same scheme modern PDF programs use). Runs entirely on the device through the
   browser's built-in Web Crypto — no library, no network.

   Usage:  const bytes = await Nyx.pdfEncrypt(PDFLib, pdfDoc, "password");        (returns the saved file)

   Used by Parchment on export. Works in a plain browser tab and inside the Android app. */
(function(){
  "use strict";
  const subtle = (window.crypto || {}).subtle;
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const cat = (...parts) => {
    let n = 0; parts.forEach(p => n += p.length);
    const out = new Uint8Array(n); let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  };
  const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, "0")).join("");
  const sha = async (bits, data) => new Uint8Array(await subtle.digest("SHA-" + bits, data));
  const ZERO_IV = new Uint8Array(16);
  const EMPTY = new Uint8Array(0);

  /* AES-CBC without padding: WebCrypto always pads, so encrypt and drop the extra final block. */
  async function aesNoPad(key, iv, data){
    const k = await subtle.importKey("raw", key, "AES-CBC", false, ["encrypt"]);
    const out = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, k, data));
    return out.subarray(0, data.length);
  }
  /* The per-string / per-stream form: random IV in front, PKCS#7 padding behind. */
  async function aesObject(keyObj, data){
    const iv = rand(16);
    const out = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, keyObj, data));
    return cat(iv, out);
  }

  /* ISO 32000-2 algorithm 2.B (the revision 6 password hash). */
  async function hash2B(pw, salt, udata){
    let K = await sha(256, cat(pw, salt, udata));
    let i = 0, E;
    for(;;){
      const unit = cat(pw, K, udata);
      const K1 = new Uint8Array(unit.length * 64);
      for(let j = 0; j < 64; j++) K1.set(unit, j * unit.length);
      E = await aesNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
      let m = 0; for(let j = 0; j < 16; j++) m += E[j];
      K = await sha([256, 384, 512][m % 3], E);
      i++;
      if(i >= 64 && E[E.length - 1] <= i - 32) break;
    }
    return K.subarray(0, 32);
  }

  async function pdfEncrypt(PDFLib, doc, password){
    if(!subtle) throw new Error("This browser can't do encryption here (it needs a secure page).");
    const { PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFStream, PDFName, PDFNumber } = PDFLib;
    const ctx = doc.context;

    /* --- keys --- */
    let pw = new TextEncoder().encode(String(password)); if(pw.length > 127) pw = pw.subarray(0, 127);
    const fileKey = rand(32);
    const uVal = rand(8), uKey = rand(8);
    const U = cat(await hash2B(pw, uVal, EMPTY), uVal, uKey);
    const UE = await aesNoPad(await hash2B(pw, uKey, EMPTY), ZERO_IV, fileKey);
    const oVal = rand(8), oKey = rand(8);          /* owner password = the same password, so it also gets full rights */
    const O = cat(await hash2B(pw, oVal, U), oVal, oKey);
    const OE = await aesNoPad(await hash2B(pw, oKey, U), ZERO_IV, fileKey);
    const P = -4;                                   /* every permission allowed; the point is the open password */
    const permsPlain = cat(new Uint8Array([P & 255, (P >> 8) & 255, (P >> 16) & 255, (P >> 24) & 255, 255, 255, 255, 255, 0x54, 0x61, 0x64, 0x62]), rand(4));
    const Perms = await aesNoPad(fileKey, ZERO_IV, permsPlain);   /* one block: ECB == CBC with a zero IV */
    const objKey = await subtle.importKey("raw", fileKey, "AES-CBC", false, ["encrypt"]);

    /* pdf-lib creates embedded fonts and pictures only when saving; make them now so they get encrypted too */
    if(typeof doc.flush === "function") await doc.flush();

    /* --- encrypt every string and stream already in the document --- */
    const encStr = async s => PDFHexString.of(hex(await aesObject(objKey, s.asBytes())));
    async function walk(node){
      if(node instanceof PDFDict){
        for(const [k, v] of node.entries()){
          if(v instanceof PDFString || v instanceof PDFHexString) node.set(k, await encStr(v));
          else if(v instanceof PDFDict || v instanceof PDFArray) await walk(v);
        }
      }else if(node instanceof PDFArray){
        for(let i = 0; i < node.size(); i++){
          const v = node.get(i);
          if(v instanceof PDFString || v instanceof PDFHexString) node.set(i, await encStr(v));
          else if(v instanceof PDFDict || v instanceof PDFArray) await walk(v);
        }
      }
    }
    for(const [ref, obj] of Array.from(ctx.enumerateIndirectObjects())){
      if(obj instanceof PDFStream){
        const t = obj.dict.get(PDFName.of("Type"));
        if(t && /^(ObjStm|XRef)$/.test(String(t.asString ? t.asString() : t).replace("/", ""))) continue;
        await walk(obj.dict);
        const body = await aesObject(objKey, obj.getContents());
        const d = PDFDict.withContext(ctx);
        for(const [k, v] of obj.dict.entries()) d.set(k, v);
        d.set(PDFName.of("Length"), PDFNumber.of(body.length));
        ctx.assign(ref, PDFRawStream.of(d, body));
      }else if(obj instanceof PDFString || obj instanceof PDFHexString){
        ctx.assign(ref, await encStr(obj));
      }else if(obj instanceof PDFDict || obj instanceof PDFArray){
        await walk(obj);
      }
    }

    /* --- the Encrypt dictionary (its own strings are never encrypted) and the file ID --- */
    const H = b => PDFHexString.of(hex(b));
    const encRef = ctx.register(ctx.obj({
      Filter: "Standard", V: 5, R: 6, Length: 256, P, EncryptMetadata: true,
      CF: { StdCF: { AuthEvent: "DocOpen", CFM: "AESV3", Length: 32 } }, StmF: "StdCF", StrF: "StdCF",
      O: H(O), U: H(U), OE: H(OE), UE: H(UE), Perms: H(Perms)
    }));
    ctx.trailerInfo.Encrypt = encRef;
    const id = H(rand(16));
    ctx.trailerInfo.ID = ctx.obj([id, id]);

    /* object streams would be written after encryption and so stay readable — turn them off */
    return doc.save({ useObjectStreams: false });
  }

  (window.Nyx = window.Nyx || {}).pdfEncrypt = pdfEncrypt;
  if(typeof module !== "undefined") module.exports = pdfEncrypt;
})();

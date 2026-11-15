package app.nyxdesk

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.OpenableColumns
import android.util.Base64
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Nyxdesk for Android.
 *
 * A thin native shell around the Nyxdesk web app, which is bundled in the APK (assets/) and served to a
 * WebView from a private https origin. The shell adds the things a browser tab can't do:
 *   - appears under "Open with" and in the Share sheet for documents, sheets, decks and PDFs
 *   - a real Android file picker for "Open a file"
 *   - saves through Android's "Save to…" picker (a WebView cannot save blob: downloads by itself)
 *   - printing / "Save as PDF" through Android's print system
 *   - blocks every request that is not to its own bundled files
 */
class MainActivity : AppCompatActivity() {

    private class SaveJob(val name: String) {
        val data = ByteArrayOutputStream()
    }

    private lateinit var web: WebView
    private var pageReady = false
    private var pendingJs: String? = null
    private var counter = 0

    private val incoming = ConcurrentHashMap<String, Uri>()
    private val saves = ConcurrentHashMap<Int, SaveJob>()
    private var nextSaveId = 0
    private val saveQueue = ArrayDeque<SaveJob>()
    private var saving: SaveJob? = null
    private var chooserCallback: ValueCallback<Array<Uri>>? = null

    private val chooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = chooserCallback
            chooserCallback = null
            cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        }

    private val saveLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
            finishSaveTo(uri)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        web = WebView(this)
        setContentView(web)
        web.setBackgroundColor(Color.parseColor("#0E0B0C"))

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true            // localStorage + IndexedDB (where files are autosaved)
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.mediaPlaybackRequiresUserGesture = true
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        disableForcedDarkening(s)

        web.addJavascriptInterface(Bridge(), "NyxAndroid")

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return serve(request.url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == HOST) return false
                val scheme = u.scheme
                if (scheme == "http" || scheme == "https" || scheme == "mailto") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, u))
                    } catch (e: ActivityNotFoundException) {
                        toast("No app can open that link.")
                    }
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                pageReady = true
                val js = pendingJs
                if (js != null) {
                    pendingJs = null
                    view.evaluateJavascript(js, null)
                }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                chooserCallback?.onReceiveValue(null)
                chooserCallback = filePathCallback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    // "*/*" on purpose: phones label many of these files with odd MIME types, and a stricter
                    // filter would grey them out. Nyxdesk itself decides by file extension.
                    type = "*/*"
                    if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }
                return try {
                    chooserLauncher.launch(intent)
                    true
                } catch (e: ActivityNotFoundException) {
                    chooserCallback = null
                    filePathCallback.onReceiveValue(null)
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the page close an open menu, dialog or presentation first.
                web.evaluateJavascript(
                    "(function(){try{return !!(window.__nyxBack&&window.__nyxBack())}catch(e){return false}})()"
                ) { handled ->
                    if (handled != "true") {
                        if (web.canGoBack()) {
                            web.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            }
        })

        handleIntent(intent)
        web.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun disableForcedDarkening(s: WebSettings) {
        // Nyxdesk has its own light and dark themes; stop Android from re-tinting the pages on top of them.
        if (Build.VERSION.SDK_INT in 29..32) s.forceDark = WebSettings.FORCE_DARK_OFF
    }

    // ---------------------------------------------------------------- files coming IN

    @Suppress("DEPRECATION")
    private fun streamUri(i: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else i.getParcelableExtra(Intent.EXTRA_STREAM)

    private fun handleIntent(i: Intent?) {
        if (i == null) return
        val uri: Uri? = when (i.action) {
            Intent.ACTION_VIEW -> i.data
            Intent.ACTION_SEND -> streamUri(i)
            else -> null
        }
        if (uri != null) deliver(uri)
    }

    private fun queryName(uri: Uri): String {
        var found: String? = null
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) found = c.getString(0)
            }
        } catch (e: Exception) {
            // fall through to the last path segment
        }
        val n = found
        return if (!n.isNullOrBlank()) n else (uri.lastPathSegment?.substringAfterLast('/') ?: "file")
    }

    /** Make the file reachable by the web app at a private URL, then tell the web app to open it. */
    private fun deliver(uri: Uri) {
        val name = queryName(uri)
        val mime = contentResolver.getType(uri) ?: ""
        counter += 1
        val key = counter.toString()
        incoming[key] = uri
        val js = "window.__nyxIncoming && window.__nyxIncoming('/__incoming__/" + key + "', " +
            JSONObject.quote(name) + ", " + JSONObject.quote(mime) + ");"
        if (pageReady) web.evaluateJavascript(js, null) else pendingJs = js
    }

    // ---------------------------------------------------------------- serving the bundled web app

    private fun reply(status: Int, reason: String, body: String): WebResourceResponse =
        WebResourceResponse(
            "text/plain", "utf-8", status, reason, emptyMap<String, String>(),
            ByteArrayInputStream(body.toByteArray())
        )

    private fun serve(url: Uri): WebResourceResponse? {
        val scheme = url.scheme ?: return null
        if (scheme != "https" && scheme != "http") return null          // blob:, data: etc. are handled by the WebView
        if (url.host != HOST) return reply(403, "Blocked", "Nyxdesk makes no network requests.")

        var path = url.path ?: "/"
        if (path.startsWith("/__incoming__/")) return serveIncoming(path.removePrefix("/__incoming__/"))
        if (path == "/") path = "/index.html"
        val asset = path.trimStart('/')

        return try {
            val type = mimeFor(asset)
            val textual = type.startsWith("text/") || type.endsWith("javascript") ||
                type.endsWith("json") || type.endsWith("xml")
            WebResourceResponse(type, if (textual) "utf-8" else null, assets.open(asset))
        } catch (e: IOException) {
            reply(404, "Not Found", "Not found")
        }
    }

    private fun serveIncoming(key: String): WebResourceResponse {
        val uri = incoming[key] ?: return reply(404, "Not Found", "Not found")
        return try {
            val stream = contentResolver.openInputStream(uri) ?: return reply(404, "Not Found", "Not found")
            WebResourceResponse("application/octet-stream", null, stream)
        } catch (e: Exception) {
            reply(500, "Error", "Couldn't read the file")
        }
    }

    private fun mimeFor(path: String): String {
        return when (path.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"       // .mjs must be a JavaScript type or module scripts are refused
            "css" -> "text/css"
            "json" -> "application/json"
            "webmanifest" -> "application/manifest+json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "wasm" -> "application/wasm"
            "md", "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }

    // ---------------------------------------------------------------- files going OUT

    private fun startNextSave() {
        if (saving != null) return
        val job = saveQueue.removeFirstOrNull() ?: return
        saving = job
        try {
            saveLauncher.launch(job.name)
        } catch (e: Exception) {
            saving = null
            toast("Couldn't open the save dialog.")
            startNextSave()
        }
    }

    private fun finishSaveTo(uri: Uri?) {
        val job = saving
        saving = null
        if (job != null && uri != null) {
            Thread {
                try {
                    contentResolver.openOutputStream(uri, "w")?.use { it.write(job.data.toByteArray()) }
                    runOnUiThread { toast("Saved “" + job.name + "”") }
                } catch (e: Exception) {
                    runOnUiThread { toast("Couldn't save: " + e.message) }
                }
            }.start()
        } else if (job != null) {
            toast("Save cancelled.")
        }
        startNextSave()
    }

    private fun doPrint() {
        val pm = getSystemService(PRINT_SERVICE) as PrintManager
        pm.print("Nyxdesk", web.createPrintDocumentAdapter("Nyxdesk"), PrintAttributes.Builder().build())
    }

    private fun applyChrome(color: String) {
        val c = try {
            Color.parseColor(color.trim())
        } catch (e: IllegalArgumentException) {
            return
        }
        window.statusBarColor = c
        window.navigationBarColor = c
        val light = ColorUtils.calculateLuminance(c) > 0.5
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = light
        controller.isAppearanceLightNavigationBars = light
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    /** The only door between the web app and Android. Exposed to JavaScript as `window.NyxAndroid`. */
    inner class Bridge {
        @JavascriptInterface
        fun beginSave(name: String, mime: String): Int {
            val id = synchronized(saves) { ++nextSaveId }
            saves[id] = SaveJob(name)
            return id
        }

        @JavascriptInterface
        fun appendSave(id: Int, base64Chunk: String) {
            saves[id]?.data?.write(Base64.decode(base64Chunk, Base64.DEFAULT))
        }

        @JavascriptInterface
        fun finishSave(id: Int) {
            val job = saves.remove(id) ?: return
            runOnUiThread {
                saveQueue.addLast(job)
                startNextSave()
            }
        }

        @JavascriptInterface
        fun print() {
            runOnUiThread { doPrint() }
        }

        @JavascriptInterface
        fun setChrome(color: String) {
            runOnUiThread { applyChrome(color) }
        }

        @JavascriptInterface
        fun getClipboard(): String {
            return try {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = cm.primaryClip
                if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity).toString() else ""
            } catch (e: Exception) {
                ""
            }
        }

        @JavascriptInterface
        fun setClipboard(text: String) {
            runOnUiThread {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Nyxdesk", text))
            }
        }

        /** Full-screen, screen-on presenting. */
        @JavascriptInterface
        fun setImmersive(on: Boolean) {
            runOnUiThread {
                val c = WindowCompat.getInsetsController(window, window.decorView)
                if (on) {
                    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    c.hide(WindowInsetsCompat.Type.systemBars())
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    c.show(WindowInsetsCompat.Type.systemBars())
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }

        /** On-device text recognition (ML Kit, bundled model, no network). Answers through window.__nyxOcrDone. */
        @JavascriptInterface
        fun ocr(id: Int, base64: String, script: String) {
            Thread {
                try {
                    val bytes = Base64.decode(base64, Base64.DEFAULT)
                    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    if (bmp == null) {
                        ocrReply(id, "{\"error\":\"Couldn't read the page image.\"}")
                        return@Thread
                    }
                    val rec = if (script == "devanagari")
                        TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
                    else
                        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                    rec.process(InputImage.fromBitmap(bmp, 0))
                        .addOnSuccessListener { text ->
                            val lines = JSONArray()
                            for (block in text.textBlocks) {
                                for (line in block.lines) {
                                    val r = line.boundingBox ?: continue
                                    lines.put(
                                        JSONObject()
                                            .put("t", line.text)
                                            .put("x0", r.left).put("y0", r.top)
                                            .put("x1", r.right).put("y1", r.bottom)
                                    )
                                }
                            }
                            val out = JSONObject().put("w", bmp.width).put("h", bmp.height).put("lines", lines)
                            rec.close()
                            ocrReply(id, out.toString())
                        }
                        .addOnFailureListener { e ->
                            rec.close()
                            ocrReply(id, JSONObject().put("error", e.message ?: "Text recognition failed").toString())
                        }
                } catch (e: Exception) {
                    ocrReply(id, JSONObject().put("error", e.message ?: "Text recognition failed").toString())
                }
            }.start()
        }
    }

    private fun ocrReply(id: Int, json: String) {
        runOnUiThread {
            web.evaluateJavascript(
                "window.__nyxOcrDone && window.__nyxOcrDone(" + id + ", " + JSONObject.quote(json) + ");", null
            )
        }
    }

    companion object {
        private const val HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://appassets.androidplatform.net/index.html"
    }
}

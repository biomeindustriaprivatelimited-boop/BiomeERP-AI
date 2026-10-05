package com.biome.erp

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.text.InputType
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL

/**
 * Biome ERP for Android.
 *
 * The phone is a window onto the SAME server the desktop app uses: same
 * login, same data, same moment. Nothing is stored on the phone except the
 * sign-in cookie and the server address, so a lost phone loses no records
 * and every entry appears on every PC as soon as it is saved.
 *
 * First launch asks for the server address (the one the desktop app shows
 * under "Open on phone", e.g. http://192.168.1.50:4173). If the server
 * cannot be reached, the error screen offers "Change server".
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private lateinit var mainClient: WebViewClient

    private val prefs by lazy { getSharedPreferences("biome", Context.MODE_PRIVATE) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        swipe = SwipeRefreshLayout(this).apply {
            addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            setColorSchemeColors(0xFF1E4E08.toInt())
            setOnRefreshListener { web.reload() }
            // Only refresh when the page is scrolled to the very top, so a
            // long list scrolls normally instead of reloading.
            setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
        }
        setContentView(FrameLayout(this).apply { addView(swipe) })

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString BiomeERP-Android/1.0"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)

        mainClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                swipe.isRefreshing = true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipe.isRefreshing = false
                // Keep the sign-in across app restarts.
                CookieManager.getInstance().flush()
                // The server disabled this account (resigned / terminated):
                // the page has already cleared its own storage; also drop
                // the WebView's cache and web storage for this app.
                if (url != null && url.contains("/login?disabled=1")) {
                    android.webkit.WebStorage.getInstance().deleteAllData()
                    view?.clearCache(true)
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val target = request?.url ?: return false
                val server = Uri.parse(serverUrl() ?: return false)
                // Our own server stays inside the app; anything else (a
                // Google Drive link, a phone number) opens in its own app.
                return if (target.host == server.host && target.port == server.port) {
                    false
                } else {
                    try { startActivity(Intent(Intent.ACTION_VIEW, target)) } catch (_: Exception) {}
                    true
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    swipe.isRefreshing = false
                    showOfflinePage()
                    // The phone may have moved between office Wi-Fi and mobile data.
                    main.postDelayed({ autoConnect() }, 2000)
                }
            }
        }
        web.webViewClient = mainClient

        web.webChromeClient = object : WebChromeClient() {
            // <input type="file"> — attach a bill photo from the camera or gallery.
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                openChooser(params?.isCaptureEnabled == true)
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        // No address to type: the app finds the server by itself.
        autoConnect()
    }

    // ---- Finding the server ----------------------------------------
    //
    // Office Wi-Fi: the server answers a broadcast on UDP 4175.
    // Anywhere else: the office static IP built into the app.
    // The last address that worked is tried as well.

    private val builtIn = listOf("http://122.180.246.211:30360", "http://122.180.246.211:4173")
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var searching = false

    private fun autoConnect() {
        if (searching) return
        searching = true
        Thread {
            val found = findServer()
            main.post {
                searching = false
                if (found != null) {
                    prefs.edit().putString("server", found).apply()
                    web.webViewClient = mainClient
                    loadHome()
                } else {
                    showOfflinePage()
                    main.postDelayed({ autoConnect() }, 5000)
                }
            }
        }.start()
    }

    private fun findServer(): String? {
        val candidates = LinkedHashSet<String>()
        candidates.addAll(discoverLan())
        serverUrl()?.let { candidates.add(it) }
        candidates.addAll(builtIn)
        var fallback: String? = null
        for (c in candidates) {
            when (probe(c)) {
                2 -> return c          // developer signed in on the server PC
                1 -> if (fallback == null) fallback = c
            }
        }
        return fallback
    }

    /** 0 = no Biome server, 1 = Biome server (not ready), 2 = ready. */
    private fun probe(base: String): Int {
        return try {
            val conn = URL("${base.trimEnd('/')}/api/health").openConnection() as HttpURLConnection
            conn.connectTimeout = 3500
            conn.readTimeout = 3500
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()
            when {
                !body.contains("\"startedAt\"") -> 0
                body.contains("\"owned\":false") -> 1
                else -> 2
            }
        } catch (_: Exception) { 0 }
    }

    private fun discoverLan(): List<String> {
        val out = mutableListOf<String>()
        try {
            DatagramSocket().use { sock ->
                sock.broadcast = true
                sock.soTimeout = 1500
                val ask = "BIOME_DISCOVER_V1".toByteArray()
                sock.send(DatagramPacket(ask, ask.size, InetAddress.getByName("255.255.255.255"), 4175))
                val buf = ByteArray(1024)
                val until = System.currentTimeMillis() + 1500
                while (System.currentTimeMillis() < until) {
                    val p = DatagramPacket(buf, buf.size)
                    try { sock.receive(p) } catch (_: Exception) { break }
                    val txt = String(p.data, 0, p.length)
                    if (txt.contains("\"biome\":true")) {
                        val port = Regex("\"port\":(\\d+)").find(txt)?.groupValues?.get(1) ?: "4173"
                        out.add("http://${p.address.hostAddress}:$port")
                    }
                }
            }
        } catch (_: Exception) {}
        return out
    }

    private fun serverUrl(): String? = prefs.getString("server", null)

    private fun loadHome() {
        val base = serverUrl() ?: return askForServer()
        web.loadUrl("${base.trimEnd('/')}/m")
    }

    /** Ask once for the office server address; kept until changed. */
    private fun askForServer() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            hint = "http://192.168.1.50:4173"
            setText(serverUrl() ?: "http://")
            setSelection(text.length)
        }
        AlertDialog.Builder(this)
            .setTitle("Biome server address")
            .setMessage("Open the Biome app on the server PC → Settings → Server & Sync, and type the address shown there. Office Wi-Fi: the 192.168… address. Anywhere else: the office static IP.")
            .setView(input)
            .setCancelable(serverUrl() != null)
            .setPositiveButton("Connect") { _, _ ->
                var url = input.text.toString().trim()
                if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://$url"
                // The Biome server listens on 4173; an address typed without a
                // port ("192.168.1.50" or the office static IP) gets it.
                try {
                    val u = Uri.parse(url)
                    if (u.port == -1 && u.scheme == "http" && !u.host.isNullOrEmpty()) url = "http://${u.host}:4173"
                } catch (_: Exception) {}
                prefs.edit().putString("server", url.trimEnd('/')).apply()
                loadHome()
            }
            .show()
    }

    private fun showOfflinePage() {
        val html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
              background:#0b1d04;color:#e2f6d5;font-family:sans-serif;text-align:center;padding:24px">
            <div><h2 style="margin:0 0 8px">Server connection lost</h2>
            <p style="opacity:.75;font-size:14px;line-height:1.5">The Biome server is not answering. Check that the server PC
            is on and the Biome app is open there. Reconnecting by itself…</p>
            <p style="font-size:13px;opacity:.6">Server: ${serverUrl() ?: "not set"}</p>
            <p><a href="biome://retry" style="color:#9fe870">Try again</a> &nbsp;·&nbsp;
               <a href="biome://server" style="color:#9fe870">Change server</a></p></div></body></html>
        """.trimIndent()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                when (request?.url?.toString()) {
                    "biome://retry" -> { autoConnect(); return true }
                    "biome://server" -> { web.webViewClient = mainClient; askForServer(); return true }
                }
                return false
            }
        }
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    // ---- File chooser: camera or gallery ------------------------------

    private fun openChooser(preferCamera: Boolean) {
        val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
        }
        val extras = mutableListOf<Intent>()
        if (hasCamera()) {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val photo = File(dir, "bill-${System.currentTimeMillis()}.jpg")
            cameraUri = FileProvider.getUriForFile(this, "$packageName.files", photo)
            extras += Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
        }
        val chooser = Intent.createChooser(if (preferCamera && extras.isNotEmpty()) extras.first() else pick, "Attach")
        if (!(preferCamera && extras.isNotEmpty())) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toTypedArray())
        try {
            startActivityForResult(chooser, REQ_FILE)
        } catch (_: Exception) {
            fileCallback?.onReceiveValue(null); fileCallback = null
            Toast.makeText(this, "No app on this phone can pick a file.", Toast.LENGTH_LONG).show()
        }
    }

    private fun hasCamera(): Boolean {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) return true
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
        return false
    }

    @Deprecated("Using the classic result API keeps this file dependency-free.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE) return
        val result: Array<Uri>? = when {
            resultCode != Activity.RESULT_OK -> null
            data?.data != null -> arrayOf(data.data!!)
            data?.clipData != null -> Array(data.clipData!!.itemCount) { data.clipData!!.getItemAt(it).uri }
            cameraUri != null -> arrayOf(cameraUri!!)
            else -> null
        }
        fileCallback?.onReceiveValue(result)
        fileCallback = null
    }

    companion object {
        private const val REQ_FILE = 41
        private const val REQ_CAMERA = 42
    }
}

package com.sanspet.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.provider.Settings
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** 让桥能拿到当前 Activity（申请截屏授权要用 Activity 弹系统对话框） */
object ScreenPermission {
    @Volatile var activity: MainActivity? = null
}

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ScreenPermission.activity = this

        webView = WebView(this)
        setContentView(webView)

        val bridge = PetBridge(this, null)
        bridge.attach(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
        }
        webView.setBackgroundColor(Color.BLACK)
        webView.webViewClient = WebViewClient()

        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsConfirm(
                view: WebView?, url: String?, message: String?, result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setCancelable(false)
                    .setPositiveButton("确定") { _, _ -> result?.confirm() }
                    .setNegativeButton("取消") { _, _ -> result?.cancel() }
                    .show()
                return true
            }

            override fun onJsAlert(
                view: WebView?, url: String?, message: String?, result: JsResult?
            ): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("好") { _, _ -> result?.confirm() }
                    .setCancelable(false)
                    .show()
                return true
            }
        }

        webView.addJavascriptInterface(bridge, "SansPet")
        webView.loadUrl("file:///android_asset/index.html")
    }

    /** 申请截屏授权（系统会弹一次确认框，同意后就能静默截图） */
    fun askScreenCapture() {
        try {
            val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            startActivityForResult(mgr.createScreenCaptureIntent(), REQ_CAPTURE)
        } catch (_: Exception) {
        }
    }

    /** 跳到系统的「使用情况访问」设置页 */
    fun openUsageAccessSettings() {
        try {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            } catch (_: Exception) {
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        if (resultCode == Activity.RESULT_OK && data != null) {
            ScreenConsent.resultCode = resultCode
            ScreenConsent.data = data
            // 通知桌宠：可以初始化截图器了
            try { OverlayPetService.instance?.initScreenCapture() } catch (_: Exception) {}
        } else {
            ScreenConsent.clear()
        }
    }

    override fun onDestroy() {
        if (ScreenPermission.activity === this) ScreenPermission.activity = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val REQ_CAPTURE = 1001
    }
}

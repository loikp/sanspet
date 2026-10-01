package com.sanspet.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlin.math.roundToInt

class OverlayPetService : Service() {

    private lateinit var wm: WindowManager
    private lateinit var webView: WebView
    private lateinit var params: WindowManager.LayoutParams
    private val bridge: PetBridge by lazy { PetBridge(this, this) }
    private val store: Store by lazy { Store(this) }

    private var expanded = false
    private var added = false

    /** 桌宠左上角坐标（像素），紧凑模式用 */
    private var posX = 0
    private var posY = 0

    private val screenW: Int get() = resources.displayMetrics.widthPixels
    private val screenH: Int get() = resources.displayMetrics.heightPixels

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager

        initPosition()

        webView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            alpha = 0f
            with(settings) {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                mediaPlaybackRequiresUserGesture = false
            }
            addJavascriptInterface(bridge, "SansPet")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    // 等页面渲染完再挂上去，避免出场闪一下
                    showWhenReady()
                }
            }
            loadUrl("file:///android_asset/overlay.html")
        }
        bridge.attach(webView)
        params = buildParams(false)
    }

    private fun showWhenReady() {
        if (added) return
        added = true
        try {
            wm.addView(webView, params)
        } catch (_: Exception) {
            return
        }
        webView.animate().alpha(1f).setDuration(160).start()
    }

    /** 读取上次保存的位置，没有就放在右下角 */
    private fun initPosition() {
        val w = dp(COMPACT_W)
        val h = dp(COMPACT_H)
        val maxX = (screenW - w).coerceAtLeast(0)
        val maxY = (screenH - h).coerceAtLeast(0)
        val sx = store.get(KEY_X, "").toIntOrNull()
        val sy = store.get(KEY_Y, "").toIntOrNull()
        posX = (sx ?: (maxX - dp(6))).coerceIn(0, maxX)
        posY = (sy ?: (maxY - dp(90))).coerceIn(0, maxY)
    }

    private fun buildParams(isExpanded: Boolean): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val base = WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED

        return if (isExpanded) {
            WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                base,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            }
        } else {
            WindowManager.LayoutParams(
                dp(COMPACT_W), dp(COMPACT_H), type,
                base or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                x = posX
                y = posY
            }
        }
    }

    /** 由网页里的拖拽调用，dx/dy 是本次移动的像素增量 */
    fun moveBy(dx: Double, dy: Double) {
        if (expanded) return
        val maxX = (screenW - params.width).coerceAtLeast(0)
        val maxY = (screenH - params.height).coerceAtLeast(0)
        posX = (posX + dx).roundToInt().coerceIn(0, maxX)
        posY = (posY + dy).roundToInt().coerceIn(0, maxY)
        params.x = posX
        params.y = posY
        try {
            wm.updateViewLayout(webView, params)
        } catch (_: Exception) {
        }
    }

    fun savePosition() {
        store.set(KEY_X, posX.toString())
        store.set(KEY_Y, posY.toString())
    }

    fun setExpanded(value: Boolean) {
        if (expanded == value) return
        expanded = value
        params = buildParams(value)
        if (added) {
            try {
                wm.updateViewLayout(webView, params)
            } catch (_: Exception) {
            }
        }
        webView.evaluateJavascript("window.__setExpanded && window.__setExpanded($value)", null)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun startForegroundNotification() {
        val channelId = "sanspet"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "SansPet", NotificationManager.IMPORTANCE_MIN
            )
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("SansPet")
            .setContentText("Sans 正在你的桌面上")
            .setSmallIcon(R.drawable.ic_notify)
            .setOngoing(true)
            .build()

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, 1, notification, type)
    }

    override fun onDestroy() {
        savePosition()
        try {
            if (added) wm.removeView(webView)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val COMPACT_W = 176
        private const val COMPACT_H = 216
        private const val KEY_X = "petX"
        private const val KEY_Y = "petY"
    }
}

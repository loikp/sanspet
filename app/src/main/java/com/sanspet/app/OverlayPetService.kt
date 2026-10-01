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
import android.view.MotionEvent
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlin.math.abs
import kotlin.math.roundToInt

class OverlayPetService : Service() {

    private lateinit var wm: WindowManager
    private lateinit var webView: WebView
    private lateinit var params: WindowManager.LayoutParams
    private val bridge: PetBridge by lazy { PetBridge(this, this) }
    private val store: Store by lazy { Store(this) }

    private var expanded = false
    private var added = false

    /** 紧凑窗口左上角（像素） */
    private var posX = 0
    private var posY = 0

    /** 由网页上报的内容尺寸（像素） */
    private var compactW = 0
    private var compactH = 0
    private var expandedW = 0
    private var expandedH = 0

    private var dragging = false
    private var dragMoved = false
    private var dragStartRawX = 0f
    private var dragStartRawY = 0f
    private var dragStartX = 0
    private var dragStartY = 0

    private val density: Float get() = resources.displayMetrics.density
    private val screenW: Int get() = resources.displayMetrics.widthPixels
    private val screenH: Int get() = resources.displayMetrics.heightPixels

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager

        // 先用估算尺寸放好，等网页上报真实尺寸后再校正
        compactW = dp(120)
        compactH = dp(150)
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
                    view?.evaluateJavascript(
                        "window.__screen && window.__screen(${screenW / density}, ${screenH / density})",
                        null
                    )
                    showWhenReady()
                }
            }
            loadUrl("file:///android_asset/overlay.html")
        }
        bridge.attach(webView)
        attachDragHandler()

        params = buildParams()
        applyLayout()
    }

    private fun showWhenReady() {
        if (added) return
        added = true
        try {
            wm.addView(webView, params)
        } catch (_: Exception) {
            return
        }
        applyLayout()
        webView.animate().alpha(1f).setDuration(160).start()
    }

    private fun initPosition() {
        val maxX = (screenW - compactW).coerceAtLeast(0)
        val maxY = (screenH - compactH).coerceAtLeast(0)
        val sx = store.get(KEY_X, "").toIntOrNull()
        val sy = store.get(KEY_Y, "").toIntOrNull()
        posX = (sx ?: (maxX - dp(6))).coerceIn(0, maxX)
        posY = (sy ?: (maxY - dp(90))).coerceIn(0, maxY)
    }

    private fun buildParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        return WindowManager.LayoutParams(
            compactW,
            compactH,
            type,
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = posX
            y = posY
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
    }

    /**
     * 窗口 = 内容大小。
     * 展开时向右上生长，角色在屏幕上的位置保持不变；
     * 窗口之外的地方不遮挡，可以正常点击。
     */
    private fun applyLayout() {
        if (!added) return

        val w: Int
        val h: Int
        if (expanded) {
            w = if (expandedW > 0) expandedW else compactW
            h = if (expandedH > 0) expandedH else compactH
        } else {
            w = compactW
            h = compactH
        }

        var x = if (expanded) posX + compactW - w else posX
        var y = if (expanded) posY + compactH - h else posY
        x = x.coerceIn(0, (screenW - w).coerceAtLeast(0))
        y = y.coerceIn(0, (screenH - h).coerceAtLeast(0))

        params.width = w
        params.height = h
        params.x = x
        params.y = y
        params.flags = if (expanded) {
            params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        } else {
            params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        }

        try {
            wm.updateViewLayout(webView, params)
        } catch (_: Exception) {
        }
    }

    /** 网页上报紧凑尺寸（CSS px） */
    fun setCompactSize(w: Double, h: Double) {
        val pw = (w * density).roundToInt().coerceAtLeast(dp(30))
        val ph = (h * density).roundToInt().coerceAtLeast(dp(30))
        if (pw == compactW && ph == compactH) return
        compactW = pw
        compactH = ph
        if (!expanded) applyLayout()
    }

    /** 网页上报展开尺寸（CSS px） */
    fun setExpandedSize(w: Double, h: Double) {
        val pw = (w * density).roundToInt().coerceAtLeast(dp(30))
        val ph = (h * density).roundToInt().coerceAtLeast(dp(30))
        val maxW = screenW
        val maxH = screenH
        val cw = pw.coerceAtMost(maxW)
        val ch = ph.coerceAtMost(maxH)
        if (cw == expandedW && ch == expandedH) return
        expandedW = cw
        expandedH = ch
        if (expanded) applyLayout()
    }

    fun setExpanded(value: Boolean) {
        if (expanded == value) return
        expanded = value
        applyLayout()
        webView.evaluateJavascript("window.__setExpanded && window.__setExpanded($value)", null)
    }

    fun refresh() {
        webView.evaluateJavascript("window.__applySettings && window.__applySettings()", null)
    }

    private fun savePosition() {
        store.set(KEY_X, posX.toString())
        store.set(KEY_Y, posY.toString())
    }

    /**
     * 原生拖拽。用 rawX/rawY（屏幕绝对坐标），不受窗口自身移动影响，所以不会抖。
     * 返回 false，让 WebView 继续处理点击。
     */
    private fun attachDragHandler() {
        val slop = dp(8)
        webView.setOnTouchListener { _, event ->
            if (expanded) return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    dragStartRawX = event.rawX
                    dragStartRawY = event.rawY
                    dragStartX = posX
                    dragStartY = posY
                    dragging = true
                    dragMoved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    if (dragging) {
                        val dx = event.rawX - dragStartRawX
                        val dy = event.rawY - dragStartRawY
                        if (!dragMoved && (abs(dx) > slop || abs(dy) > slop)) dragMoved = true
                        if (dragMoved) {
                            val maxX = (screenW - compactW).coerceAtLeast(0)
                            val maxY = (screenH - compactH).coerceAtLeast(0)
                            posX = (dragStartX + dx).roundToInt().coerceIn(0, maxX)
                            posY = (dragStartY + dy).roundToInt().coerceIn(0, maxY)
                            params.x = posX
                            params.y = posY
                            try {
                                wm.updateViewLayout(webView, params)
                            } catch (_: Exception) {
                            }
                        }
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging && dragMoved) {
                        savePosition()
                        webView.evaluateJavascript(
                            "window.__suppressClick && window.__suppressClick()", null
                        )
                    }
                    dragging = false
                    dragMoved = false
                }
            }
            false
        }
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
        private const val KEY_X = "petX"
        private const val KEY_Y = "petY"
    }
}

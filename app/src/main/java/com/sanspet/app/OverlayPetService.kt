package com.sanspet.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Region
import android.graphics.Rect
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewTreeObserver
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

    private var added = false
    private var focusable = false

    /** 宠物中心在屏幕上的坐标（像素） */
    private var posX = 0
    private var posY = 0

    /** 宠物实际尺寸（像素） */
    private var petW = 0
    private var petH = 0

    /** 窗口矩形（像素），由网页上报的内容尺寸决定 */
    private var winX = 0
    private var winY = 0
    private var winW = 0
    private var winH = 0

    /** 只有这些区域接收触摸，其余穿透到桌面 */
    private var touchRects: List<Rect> = emptyList()

    private var dragging = false
    private var dragMoved = false
    private var dragStartRawX = 0f
    private var dragStartRawY = 0f
    private var dragStartPosX = 0
    private var dragStartPosY = 0

    private val density: Float get() = resources.displayMetrics.density
    private val screenW: Int get() = resources.displayMetrics.widthPixels
    private val screenH: Int get() = resources.displayMetrics.heightPixels

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager

        petW = dp(110)
        petH = dp(120)
        winW = dp(130)
        winH = dp(170)
        initPosition()

        webView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            alpha = 0f
            isFocusable = true
            isFocusableInTouchMode = true
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
                    sendPetPos()
                    showWhenReady()
                }
            }
            loadUrl("file:///android_asset/overlay.html")
        }

        bridge.attach(webView)
        attachDragHandler()
        attachTouchRegion()

        params = buildParams()
        applyRect(false)
    }

    private fun showWhenReady() {
        if (added) return
        added = true
        try {
            wm.addView(webView, params)
        } catch (_: Exception) {
            return
        }
        applyRect(false)
        sendLayout()
        webView.animate().alpha(1f).setDuration(160).start()
    }

    private fun initPosition() {
        val sx = store.get(KEY_X, "").toFloatOrNull()
        val sy = store.get(KEY_Y, "").toFloatOrNull()
        posX = (sx ?: (screenW - petW / 2f - dp(12))).toInt()
        posY = (sy ?: (screenH - petH / 2f - dp(80))).toInt()
        clampPet()
    }

    private fun clampPet() {
        if (petW <= 0 || petH <= 0) return
        val minX = petW / 2
        val maxX = (screenW - petW / 2).coerceAtLeast(minX)
        val minY = petH / 2
        val maxY = (screenH - petH / 2).coerceAtLeast(minY)
        posX = posX.coerceIn(minX, maxX)
        posY = posY.coerceIn(minY, maxY)
    }

    private fun buildParams(): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        return WindowManager.LayoutParams(
            winW,
            winH,
            type,
            baseFlags() or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = winX
            y = winY
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
    }

    private fun baseFlags(): Int =
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED

    private fun applyRect(notify: Boolean) {
        if (!added) return
        if (winW <= 0 || winH <= 0) return
        params.width = winW
        params.height = winH
        params.x = winX
        params.y = winY
        params.flags = if (focusable) {
            baseFlags()
        } else {
            baseFlags() or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        }
        try {
            wm.updateViewLayout(webView, params)
        } catch (_: Exception) {
        }
        if (notify) {
            sendLayout()
            webView.requestLayout()
        }
    }

    private fun sendLayout() {
        webView.evaluateJavascript(
            "window.__layout && window.__layout(${winX / density}, ${winY / density})", null
        )
    }

    private fun sendPetPos() {
        webView.evaluateJavascript(
            "window.__petPos && window.__petPos(${posX / density}, ${posY / density})", null
        )
    }

    // ---------- 网页上报 ----------

    fun setPetSize(w: Double, h: Double) {
        val pw = (w * density).roundToInt().coerceAtLeast(dp(20))
        val ph = (h * density).roundToInt().coerceAtLeast(dp(20))
        if (pw == petW && ph == petH) return
        petW = pw
        petH = ph
        clampPet()
        sendPetPos()
    }

    fun setWindowRect(x: Double, y: Double, w: Double, h: Double) {
        val pw = (w * density).roundToInt().coerceIn(dp(30), screenW)
        val ph = (h * density).roundToInt().coerceIn(dp(30), screenH)
        val px = (x * density).roundToInt().coerceIn(0, (screenW - pw).coerceAtLeast(0))
        val py = (y * density).roundToInt().coerceIn(0, (screenH - ph).coerceAtLeast(0))
        if (pw == winW && ph == winH && px == winX && py == winY) return
        winW = pw
        winH = ph
        winX = px
        winY = py
        applyRect(true)
    }

    fun setFocusable(value: Boolean) {
        if (focusable == value) return
        focusable = value
        applyRect(false)
        if (value) {
            webView.requestFocus()
        }
    }

    fun setTouchRects(rects: List<Rect>) {
        touchRects = rects
        webView.requestLayout()
        webView.invalidate()
    }

    fun savePosition() {
        store.set(KEY_X, posX.toString())
        store.set(KEY_Y, posY.toString())
    }

    fun refresh() {
        webView.evaluateJavascript("window.__applySettings && window.__applySettings()", null)
    }

    /**
     * 只有宠物/对话框/按钮/输入框那几块接收触摸，
     * 窗口里的空白处直接穿透到桌面。
     */
    private fun attachTouchRegion() {
        // ViewTreeObserver 的 insets 接口是隐藏 API，用反射注册；
        // 失败就退化成整个窗口都可点，不影响其他功能。
        try {
            val listenerClass = Class.forName("android.view.ViewTreeObserver\$OnComputeInternalInsetsListener")
            val proxy = java.lang.reflect.Proxy.newProxyInstance(
                listenerClass.classLoader,
                arrayOf(listenerClass)
            ) { _, method, args ->
                if (method.name == "onComputeInternalInsets" && args != null && args.isNotEmpty()) {
                    applyTouchInsets(args[0])
                }
                null
            }
            val m = ViewTreeObserver::class.java.getDeclaredMethod(
                "addOnComputeInternalInsetsListener", listenerClass
            )
            m.isAccessible = true
            m.invoke(webView.viewTreeObserver, proxy)
        } catch (_: Throwable) {
        }
    }

    private fun applyTouchInsets(info: Any) {
        try {
            val cls = info.javaClass
            val region = cls.getMethod("getTouchableRegion").invoke(info) as Region
            val setInsets = cls.getMethod("setTouchableInsets", Integer.TYPE)
            if (touchRects.isEmpty()) {
                setInsets.invoke(info, INSETS_FRAME)
            } else {
                region.setEmpty()
                for (r in touchRects) region.union(r)
                setInsets.invoke(info, INSETS_REGION)
            }
        } catch (_: Throwable) {
        }
    }

    /**
     * 原生拖拽：rawX/rawY 是屏幕绝对坐标，不受窗口移动影响，所以不会抖。
     * 返回 false 让 WebView 继续处理点击。
     */
    private fun attachDragHandler() {
        val slop = dp(8)
        webView.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    dragStartRawX = event.rawX
                    dragStartRawY = event.rawY
                    dragStartPosX = posX
                    dragStartPosY = posY
                    dragging = true
                    dragMoved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    if (dragging) {
                        val dx = event.rawX - dragStartRawX
                        val dy = event.rawY - dragStartRawY
                        if (!dragMoved && (abs(dx) > slop || abs(dy) > slop)) dragMoved = true
                        if (dragMoved) {
                            val oldX = posX
                            val oldY = posY
                            posX = (dragStartPosX + dx).roundToInt()
                            posY = (dragStartPosY + dy).roundToInt()
                            clampPet()
                            winX += posX - oldX
                            winY += posY - oldY
                            params.x = winX
                            params.y = winY
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
                        sendPetPos()
                        sendLayout()
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

        val stopIntent = Intent(this, OverlayPetService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("SansPet")
            .setContentText("Sans 正在你的桌面上")
            .setSmallIcon(R.drawable.ic_notify)
            .setOngoing(true)
            .addAction(0, "关闭桌宠", stopPending)
            .build()

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, 1, notification, type)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
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
        private const val ACTION_STOP = "com.sanspet.app.STOP"
        private const val INSETS_FRAME = 0
        private const val INSETS_REGION = 3
        private const val KEY_X = "petX"
        private const val KEY_Y = "petY"
    }
}

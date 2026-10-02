package com.sanspet.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Region
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

/**
 * 固定窗口版悬浮桌宠。
 *
 * 窗口尺寸在创建时算好，之后【永不改变】——彻底杜绝 resize 死循环。
 * 位置以「宠物中心」为基准：posX/posY 存的就是宠物中心在屏幕上的坐标。
 */
class OverlayPetService : Service() {

    private lateinit var wm: WindowManager
    private lateinit var webView: WebView
    private lateinit var params: WindowManager.LayoutParams
    private val bridge: PetBridge by lazy { PetBridge(this, this) }
    private val store: Store by lazy { Store(this) }

    private var added = false
    private var focusable = false

    private var winW = 0
    private var winH = 0

    /** 宠物中心相对窗口左上角的偏移（像素），由网页测量后上报 */
    private var anchorX = 0
    private var anchorY = 0

    /** 宠物中心在屏幕上的坐标（像素）—— 拖拽基准 */
    private var posX = 0
    private var posY = 0

    private var touchRects: List<Rect> = emptyList()

    /** 历史面板打开时把窗口挪到屏幕正中央（面板铺满窗口，于是面板就在屏幕正中） */
    private var centered = false

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
        isRunning = true
        startForegroundNotification()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager

        // 固定尺寸，只算这一次
        winW = minOf(screenW - dp(12), dp(320)).coerceAtLeast(dp(200))
        winH = minOf(screenH - dp(60), dp(600)).coerceAtLeast(dp(300))

        // 先用估算的锚点，等网页上报真实值后校正
        anchorX = winW / 2
        anchorY = winH - dp(98) - dp(130)

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
                    showWhenReady()
                }
            }
            loadUrl("file:///android_asset/overlay.html")
        }

        bridge.attach(webView)
        attachDragHandler()
        attachTouchRegion()

        params = buildParams()
        applyPosition()
    }

    private fun showWhenReady() {
        if (added) return
        added = true
        try {
            wm.addView(webView, params)
        } catch (_: Exception) {
            return
        }
        applyPosition()
        webView.animate().alpha(1f).setDuration(160).start()
    }

    private fun initPosition() {
        val sx = store.get(KEY_X, "").toFloatOrNull()
        val sy = store.get(KEY_Y, "").toFloatOrNull()
        posX = (sx ?: (screenW - dp(75))).toInt()
        posY = (sy ?: (screenH - dp(130))).toInt()
        clampPet()
    }

    /** 只保证宠物本身留在屏幕内；窗口可以超出屏幕 */
    private fun clampPet() {
        posX = posX.coerceIn(dp(30), (screenW - dp(30)).coerceAtLeast(dp(30)))
        posY = posY.coerceIn(dp(30), (screenH - dp(30)).coerceAtLeast(dp(30)))
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
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
    }

    private fun baseFlags(): Int =
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED

    /** 窗口位置 = 宠物中心 − 锚点偏移。只改 x/y，尺寸永远不动。 */
    private fun applyPosition() {
        if (!added) return
        if (centered) {
            params.x = (screenW - winW) / 2
            params.y = (screenH - winH) / 2
        } else {
            params.x = posX - anchorX
            params.y = posY - anchorY
        }
        params.flags = if (focusable) {
            baseFlags()
        } else {
            baseFlags() or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        }
        try {
            wm.updateViewLayout(webView, params)
        } catch (_: Exception) {
        }
    }

    // ---------- 网页上报 ----------

    /** 宠物中心相对窗口的偏移，网页量好后只上报一次（或缩放变化时） */
    fun setAnchor(x: Double, y: Double) {
        val ax = (x * density).roundToInt()
        val ay = (y * density).roundToInt()
        if (ax == anchorX && ay == anchorY) return
        anchorX = ax
        anchorY = ay
        applyPosition()
    }

    fun setCentered(value: Boolean) {
        if (centered == value) return
        centered = value
        applyPosition()
    }

    fun setFocusable(value: Boolean) {
        if (focusable == value) return
        focusable = value
        applyPosition()
        if (value) webView.requestFocus()
    }

    fun setTouchRects(rects: List<Rect>) {
        touchRects = rects
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
     * 只有宠物/对话框/按钮/输入框那几块接收触摸，窗口里的空白处穿透到桌面。
     * ViewTreeObserver 的 insets 接口是隐藏 API，用反射注册，失败就退化成整窗可点。
     */
    private fun attachTouchRegion() {
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
     * 拖拽：用 rawX/rawY（屏幕绝对坐标），不受窗口移动影响，所以不会抖。
     * 移动的是「宠物中心」，返回 false 让 WebView 继续处理点击。
     */
    private fun attachDragHandler() {
        val slop = dp(16)
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
                    if (dragging && !centered) {
                        val dx = event.rawX - dragStartRawX
                        val dy = event.rawY - dragStartRawY
                        if (!dragMoved && (abs(dx) > slop || abs(dy) > slop)) dragMoved = true
                        if (dragMoved) {
                            posX = (dragStartPosX + dx).roundToInt()
                            posY = (dragStartPosY + dy).roundToInt()
                            clampPet()
                            applyPosition()
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
        isRunning = false
        savePosition()
        try {
            if (added) wm.removeView(webView)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        /** 桌宠是否正在运行，设置页用它决定按钮显示「开启」还是「关闭」 */
        @Volatile
        var isRunning = false

        private const val ACTION_STOP = "com.sanspet.app.STOP"
        private const val INSETS_FRAME = 0
        private const val INSETS_REGION = 3
        private const val KEY_X = "petX"
        private const val KEY_Y = "petY"
    }
}

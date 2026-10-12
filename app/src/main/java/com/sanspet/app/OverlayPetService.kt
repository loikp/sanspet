package com.sanspet.app

import android.animation.ValueAnimator
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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewTreeObserver
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject
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

    /** 内容尺寸（跟着宠物高度走） */
    private var contentW = 0
    private var contentH = 0

    /** 历史面板尺寸（居中时用） */
    private var panelW = 0
    private var panelH = 0

    /** 宠物中心相对窗口的锚点（像素）：X 距左边，Y 距底边。由网页测量后上报 */
    private var anchorX = 0
    private var anchorBottom = 0

    /** 宠物中心在屏幕上的坐标（像素）—— 拖拽基准 */
    private var posX = 0
    private var posY = 0

    private var touchRects: List<Rect> = emptyList()

    /** 历史面板打开时把窗口挪到屏幕正中央（面板铺满窗口，于是面板就在屏幕正中） */
    private var centered = false

    // ---------- 锁定 / 睡眠 / 走动的公共状态 ----------

    /** 锁定位置：锁上之后不能拖动、也不能自己走 */
    private var locked = false

    /** 是否清醒。睡着时不走动、也不主动说话 */
    private var awake = true

    /** 走 / 站的调度器，以及当前朝向（给网页切序列帧用） */
    private val walkHandler = Handler(Looper.getMainLooper())
    private var walkDirName = "none"

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
        instance = this
        startForegroundNotification()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager

        // 默认尺寸，网页量好宠物高度后会重新上报（只在尺寸变化时调整，不是每帧）
        contentW = minOf(screenW - dp(12), dp(264)).coerceAtLeast(dp(200))
        contentH = minOf(screenH - dp(60), dp(400)).coerceAtLeast(dp(280))
        // 历史面板：更宽更长
        panelW = (screenW - dp(24)).coerceAtLeast(dp(200))
        panelH = (screenH * 0.78f).toInt().coerceAtLeast(dp(320))
        winW = contentW
        winH = contentH

        // 先用估算的锚点，等网页上报真实值后校正
        anchorX = winW / 2
        anchorBottom = dp(173)

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
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = true   // 让 overlay.js 能读 presets.json
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
        scheduleNextWalk()

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
        posY = posY.coerceIn(dp(60), (screenH - dp(40)).coerceAtLeast(dp(60)))
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

    private fun targetPos(): Pair<Int, Int> =
        if (centered) {
            (screenW - winW) / 2 to (screenH - winH) / 2
        } else {
            // 纵坐标按「距底边」算：窗口变高时向上生长，宠物在屏幕上不动
            (posX - anchorX) to (posY - winH + anchorBottom)
        }

    /** 平滑移动窗口（只改 x/y，不改尺寸） */
    private fun animatePositionTo(targetX: Int, targetY: Int) {
        if (!added) return
        val startX = params.x
        val startY = params.y
        if (startX == targetX && startY == targetY) return
        val anim = ValueAnimator.ofFloat(0f, 1f)
        anim.duration = 200
        anim.interpolator = DecelerateInterpolator()
        anim.addUpdateListener { a ->
            val f = a.animatedFraction
            params.x = (startX + (targetX - startX) * f).roundToInt()
            params.y = (startY + (targetY - startY) * f).roundToInt()
            try {
                wm.updateViewLayout(webView, params)
            } catch (_: Exception) {
            }
        }
        anim.start()
    }

    private fun applyPosition() {
        if (!added) return
        val (tx, ty) = targetPos()
        params.x = tx
        params.y = ty
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

    // ---------- 随机走动 ----------
    //
    // 不是一直走，而是：
    //   每隔 [walkMinMs, walkMaxMs] 随机一段时间 → 掷一次概率 walkChance
    //   命中才走一次；方向、长度都随机
    //   撞墙 → 掉头走完剩余长度
    //   走完有 nextChainChance 概率连走下一次，概率按 chainDecay 逐次递减
    //     （第2次 = chainChance，第3次 = chainChance×decay，第4次再乘…）

    private var walkEnabled = false
    private var walkMinMs = 3 * 60 * 1000L
    private var walkMaxMs = 10 * 60 * 1000L
    private var walkChance = 0.6
    private var chainChance = 0.35
    private var chainDecay = 0.5

    private var moving = false
    private var moveDX = 0
    private var moveDY = 0
    private var moveRemaining = 0.0
    private var nextChainChance = 0.0

    private val walkTrigger = object : Runnable {
        override fun run() {
            if (!walkEnabled) return
            if (!awake || locked || centered || dragging) {
                scheduleNextWalk()
                return
            }
            if (Math.random() < walkChance) {
                nextChainChance = chainChance
                startMove()
            } else {
                scheduleNextWalk()
            }
        }
    }

    private val moveStep = object : Runnable {
        override fun run() {
            if (!moving) return
            if (!walkEnabled || !awake || locked || centered || dragging) {
                endMove(false)
                return
            }
            stepMoveOnce()
            if (moving) walkHandler.postDelayed(this, 50)
        }
    }

    private fun scheduleNextWalk() {
        walkHandler.removeCallbacks(walkTrigger)
        if (!walkEnabled) return
        val span = (walkMaxMs - walkMinMs).coerceAtLeast(0L)
        val delay = walkMinMs + (Math.random() * span).toLong()
        walkHandler.postDelayed(walkTrigger, delay)
    }

    private fun startMove() {
        when ((Math.random() * 4).toInt()) {
            0 -> { moveDX = -1; moveDY = 0 }
            1 -> { moveDX = 1; moveDY = 0 }
            2 -> { moveDX = 0; moveDY = -1 }
            else -> { moveDX = 0; moveDY = 1 }
        }
        // 长度：60dp ~ 220dp 之间随机
        moveRemaining = dp(60) + Math.random() * dp(160)
        moving = true
        setWalkVisual(dirName())
        walkHandler.removeCallbacks(moveStep)
        walkHandler.postDelayed(moveStep, 50)
    }

    /** 走一小步 */
    private fun stepMoveOnce() {
        val minX = dp(60)
        val maxX = (screenW - dp(60)).coerceAtLeast(minX)
        val minY = dp(90)
        val maxY = (screenH - dp(70)).coerceAtLeast(minY)

        // 已经贴墙就先掉头
        if (moveDX < 0 && posX <= minX) moveDX = 1
        if (moveDX > 0 && posX >= maxX) moveDX = -1
        if (moveDY < 0 && posY <= minY) moveDY = 1
        if (moveDY > 0 && posY >= maxY) moveDY = -1

        val stepPx = dp(3).toDouble()
        val want = minOf(stepPx, moveRemaining)

        if (moveDX != 0) {
            val target = posX + moveDX * want
            if (target < minX) {
                // 撞墙：走到墙，剩下多少掉头接着走
                moveRemaining -= (posX - minX)
                posX = minX
                moveDX = -moveDX
            } else if (target > maxX) {
                moveRemaining -= (maxX - posX)
                posX = maxX
                moveDX = -moveDX
            } else {
                posX = target.toInt()
                moveRemaining -= want
            }
        } else {
            val target = posY + moveDY * want
            if (target < minY) {
                moveRemaining -= (posY - minY)
                posY = minY
                moveDY = -moveDY
            } else if (target > maxY) {
                moveRemaining -= (maxY - posY)
                posY = maxY
                moveDY = -moveDY
            } else {
                posY = target.toInt()
                moveRemaining -= want
            }
        }

        applyPosition()
        setWalkVisual(dirName())

        if (moveRemaining <= 0.5) endMove(true)
    }

    private fun endMove(allowChain: Boolean) {
        moving = false
        setWalkVisual("none")
        if (allowChain && nextChainChance > 0.01 && Math.random() < nextChainChance) {
            // 连走：下一次的概率逐次递减
            nextChainChance *= chainDecay
            startMove()
        } else {
            nextChainChance = 0.0
            scheduleNextWalk()
        }
    }

    private fun dirName(): String = when {
        moveDX < 0 -> "left"
        moveDX > 0 -> "right"
        moveDY < 0 -> "up"
        moveDY > 0 -> "down"
        else -> "none"
    }

    private fun setWalkVisual(name: String) {
        if (name == walkDirName) return
        walkDirName = name
        webView.evaluateJavascript("window.__setWalk && window.__setWalk('$name')", null)
    }


    // ---------- 网页上报 ----------

    /** 宠物中心相对窗口的偏移，网页量好后只上报一次（或缩放变化时） */
    fun setAnchor(x: Double, y: Double) {
        val ax = (x * density).roundToInt()
        val ab = (y * density).roundToInt().coerceAtLeast(1)
        if (ax == anchorX && ab == anchorBottom) return
        anchorX = ax
        anchorBottom = ab
        applyPosition()
    }

    /** 窗口尺寸跟着宠物高度走，只在用户改大小时触发，不是每帧 */
    fun setWindowSize(w: Double, h: Double) {
        val pw = (w * density).roundToInt().coerceIn(dp(160), screenW)
        val ph = (h * density).roundToInt().coerceIn(dp(200), screenH)
        if (pw == contentW && ph == contentH) return
        contentW = pw
        contentH = ph
        if (centered) return
        winW = pw
        winH = ph
        params.width = winW
        params.height = winH
        applyPosition()
    }

    /** 设置页传来的走动参数（JSON） */
    fun setWalkConfig(json: String) {
        try {
            val o = JSONObject(json)
            walkEnabled = o.optBoolean("enabled", false)
            val mn = o.optDouble("minMinutes", 3.0)
            val mx = o.optDouble("maxMinutes", 10.0)
            walkMinMs = (mn * 60000).toLong().coerceAtLeast(5000L)
            walkMaxMs = (mx * 60000).toLong().coerceAtLeast(walkMinMs)
            walkChance = o.optDouble("chance", 0.6).coerceIn(0.0, 1.0)
            chainChance = o.optDouble("chainChance", 0.35).coerceIn(0.0, 1.0)
            chainDecay = o.optDouble("chainDecay", 0.5).coerceIn(0.05, 1.0)
        } catch (_: Exception) {
        }

        if (!walkEnabled) {
            moving = false
            setWalkVisual("none")
            walkHandler.removeCallbacksAndMessages(null)
        } else {
            scheduleNextWalk()
        }
    }

    fun setLocked(value: Boolean) {
        locked = value
        if (value) setWalkVisual("none")
    }

    fun setAwake(value: Boolean) {
        awake = value
        if (!value) setWalkVisual("none")
    }

    fun setCentered(value: Boolean) {
        if (centered == value) return
        centered = value
        if (value) {
            winW = panelW
            winH = panelH
        } else {
            winW = contentW
            winH = contentH
        }
        params.width = winW
        params.height = winH
        val (tx, ty) = targetPos()
        animatePositionTo(tx, ty)
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

    /** 设置页清空了历史，通知悬浮窗把面板刷新、上下文丢掉 */
    fun notifyHistoryCleared() {
        webView.evaluateJavascript(
            "window.__onHistoryCleared && window.__onHistoryCleared()", null
        )
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
                    if (dragging && !centered && !locked) {
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
        walkHandler.removeCallbacksAndMessages(null)
        isRunning = false
        if (instance === this) instance = null
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

        /** 当前运行的实例。设置页那个 WebView 的桥拿不到 overlay 引用，靠这个转达消息 */
        @Volatile
        var instance: OverlayPetService? = null

        private const val ACTION_STOP = "com.sanspet.app.STOP"
        private const val INSETS_FRAME = 0
        private const val INSETS_REGION = 3
        private const val KEY_X = "petX"
        private const val KEY_Y = "petY"
    }
}

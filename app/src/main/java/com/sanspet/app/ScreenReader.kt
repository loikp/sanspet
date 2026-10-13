package com.sanspet.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.io.ByteArrayOutputStream

/** 用户授权后拿到的截屏令牌，Activity 拿、Service 用 */
object ScreenConsent {
    @Volatile var resultCode: Int = 0
    @Volatile var data: Intent? = null

    /** 最近一次截屏相关的错误，设置页会显示出来，方便定位 */
    @Volatile var lastError: String = ""

    val granted: Boolean get() = data != null

    fun clear() {
        resultCode = 0
        data = null
    }
}

/**
 * 静默截图。
 *
 * 流程：Activity 弹一次系统授权 → 把结果存进 ScreenConsent
 *      → Service 用这份令牌创建 MediaProjection → 抓一帧 → 编码成 base64 JPEG
 *
 * 抓完就释放，平时不占资源。
 */
class ScreenReader(private val context: Context) {

    private var projection: MediaProjection? = null

    var ready = false
        private set

    /** 最近一次失败的原因，给设置页显示用 */
    var lastError: String = ""
        private set

    /** 用 Activity 的授权结果初始化。必须在已 startForeground(mediaProjection) 之后调用 */
    fun init(): Boolean {
        val data = ScreenConsent.data
        if (data == null) {
            lastError = "还没有授权令牌"
            ScreenConsent.lastError = "还没有拿到系统授权令牌"
            ready = false
            return false
        }
        return try {
            val mgr = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projection = mgr.getMediaProjection(ScreenConsent.resultCode, data)
            if (projection == null) {
                lastError = "系统返回了空的 projection"
                ready = false
                return false
            }
            projection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    projection = null
                    ready = false
                    ScreenConsent.clear()
                }
            }, Handler(Looper.getMainLooper()))
            lastError = ""
            ready = true
            true
        } catch (e: Exception) {
            // 令牌只能用一次；失败就作废，让用户重新授权
            // 记录原因，但【不清】令牌 —— 清了就看不到真实错误了
            lastError = e.javaClass.simpleName + "：" + (e.message ?: "未知")
            ScreenConsent.lastError = "初始化失败 · " + lastError
            ready = false
            false
        }
    }

    /**
     * 抓一帧，缩到 maxWidth 宽，返回 base64（JPEG）。
     * 失败返回 null。**必须在子线程调用**，主线程会卡。
     */
    @SuppressLint("WrongConstant")
    fun capture(maxWidth: Int = 720, quality: Int = 60): String? {
        val mp = projection ?: return null
        var reader: ImageReader? = null
        var vd: VirtualDisplay? = null
        return try {
            val dm = context.resources.displayMetrics
            val w = dm.widthPixels
            val h = dm.heightPixels
            val dpi = dm.densityDpi

            reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
            vd = mp.createVirtualDisplay(
                "sanspet-cap", w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface, null, Handler(Looper.getMainLooper())
            )

            var image: Image? = null
            val deadline = System.currentTimeMillis() + 2500
            while (image == null && System.currentTimeMillis() < deadline) {
                image = reader.acquireLatestImage()
                if (image == null) Thread.sleep(60)
            }
            if (image == null) {
                lastError = "2.5 秒内没有拿到画面"
                ScreenConsent.lastError = "抓帧超时 · " + lastError
                return null
            }

            val plane = image.planes[0]
            val rowStride = plane.rowStride
            val pixelStride = plane.pixelStride
            val paddedWidth = if (pixelStride > 0) rowStride / pixelStride else w

            val padded = Bitmap.createBitmap(paddedWidth, h, Bitmap.Config.ARGB_8888)
            padded.copyPixelsFromBuffer(plane.buffer)
            image.close()

            val full = Bitmap.createBitmap(padded, 0, 0, w, h)
            val scale = maxWidth.toFloat() / w
            val out = if (scale < 1f) {
                Bitmap.createScaledBitmap(full, maxWidth, (h * scale).toInt(), true)
            } else {
                full
            }

            val bytes = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, quality, bytes)
            Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            lastError = e.javaClass.simpleName + "：" + (e.message ?: "未知")
            null
        } finally {
            try { vd?.release() } catch (_: Exception) {}
            try { reader?.close() } catch (_: Exception) {}
        }
    }

    fun release() {
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        ready = false
    }
}

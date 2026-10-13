package com.sanspet.app

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import java.io.ByteArrayOutputStream

/**
 * 用无障碍服务的 takeScreenshot 静默截图。
 *
 * 比 MediaProjection 省心的地方：
 *   - 在系统设置里开一次就行，不会过期
 *   - 不需要前台服务类型配合
 *   - App 重启后依然可用
 *
 * 代价：用户得手动开无障碍（各家 ROM 的入口和警告文案不太一样）。
 * 需要 Android 11（API 30）以上。
 */
class SansAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    /** 抓一帧，回调 base64 JPEG；失败给 null */
    fun grab(maxWidth: Int, quality: Int, cb: (String?) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            lastError = "系统版本低于安卓 11，不支持无障碍截图"
            cb(null)
            return
        }
        try {
            takeScreenshot(
                Display.DEFAULT_DISPLAY,
                mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(result: ScreenshotResult) {
                        var b64: String? = null
                        try {
                            val hw = result.hardwareBuffer
                            val bmp = Bitmap.wrapHardwareBuffer(hw, result.colorSpace)
                            hw.close()
                            if (bmp != null) {
                                val soft = if (bmp.config == Bitmap.Config.HARDWARE) {
                                    bmp.copy(Bitmap.Config.ARGB_8888, false)
                                } else {
                                    bmp
                                }
                                val scale = maxWidth.toFloat() / soft.width
                                val out = if (scale < 1f) {
                                    Bitmap.createScaledBitmap(
                                        soft, maxWidth, (soft.height * scale).toInt(), true
                                    )
                                } else {
                                    soft
                                }
                                val bytes = ByteArrayOutputStream()
                                out.compress(Bitmap.CompressFormat.JPEG, quality, bytes)
                                b64 = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
                            } else {
                                lastError = "截图结果是空的"
                            }
                        } catch (e: Exception) {
                            lastError = e.javaClass.simpleName + "：" + (e.message ?: "未知")
                            b64 = null
                        }
                        cb(b64)
                    }

                    override fun onFailure(errorCode: Int) {
                        lastError = "无障碍截图失败（错误码 $errorCode）"
                        cb(null)
                    }
                }
            )
        } catch (e: Exception) {
            lastError = e.javaClass.simpleName + "：" + (e.message ?: "未知")
            cb(null)
        }
    }

    companion object {
        @Volatile var instance: SansAccessibilityService? = null

        @Volatile var lastError: String = ""

        val ready: Boolean get() = instance != null
    }
}

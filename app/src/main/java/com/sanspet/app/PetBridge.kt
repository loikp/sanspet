package com.sanspet.app

import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

/**
 * WebView 与原生之间的桥。
 * 网络请求走原生层，避免浏览器跨域问题。
 */
class PetBridge(
    private val context: Context,
    private val overlay: OverlayPetService?
) {

    private val store = Store(context)
    private val main = Handler(Looper.getMainLooper())
    private var webRef: WeakReference<WebView>? = null

    fun attach(webView: WebView) {
        webRef = WeakReference(webView)
    }

    private fun callJs(js: String) {
        main.post { webRef?.get()?.evaluateJavascript(js, null) }
    }

    // ---------- 设置 / 记忆 ----------

    @JavascriptInterface
    fun getSetting(key: String?, def: String?): String = store.get(key ?: "", def ?: "")

    @JavascriptInterface
    fun setSetting(key: String?, value: String?) {
        store.set(key ?: "", value ?: "")
    }

    // ---------- 历史 ----------

    @JavascriptInterface
    fun addMessage(json: String?) {
        store.addMessage(json ?: "{}")
    }

    @JavascriptInterface
    fun getMessages(offset: Int, limit: Int): String = store.getMessages(offset, limit)

    /** 上下文记忆（发给模型用的那份），与对话历史分开 */
    @JavascriptInterface
    fun getMemory(offset: Int, limit: Int): String = store.getMemory(offset, limit)

    @JavascriptInterface
    fun countMemory(): Int = store.countMemory()

    @JavascriptInterface
    fun countMessages(): Int = store.countMessages()

    @JavascriptInterface
    fun clearMessages() {
        store.clearMessages()
    }

    /** 清空历史后通知悬浮窗刷新（设置页和桌宠是两个 WebView） */
    @JavascriptInterface
    fun notifyHistoryCleared() {
        main.post {
            (overlay ?: OverlayPetService.instance)?.notifyHistoryCleared()
        }
    }

    /** 只清上下文记忆，不动对话历史 */
    @JavascriptInterface
    fun clearMemory() {
        store.clearMemory()
    }

    // ---------- 悬浮窗 ----------


    @JavascriptInterface
    fun savePetPosition() {
        main.post { overlay?.savePosition() }
    }

    @JavascriptInterface
    fun setAnchor(x: Double, y: Double) {
        main.post { overlay?.setAnchor(x, y) }
    }

    @JavascriptInterface
    fun setWindowSize(w: Double, h: Double) {
        main.post { overlay?.setWindowSize(w, h) }
    }

    @JavascriptInterface
    fun setWalkConfig(json: String?) {
        val s = json ?: "{}"
        main.post { (overlay ?: OverlayPetService.instance)?.setWalkConfig(s) }
    }

    @JavascriptInterface
    fun setLocked(value: Boolean) {
        main.post { overlay?.setLocked(value) }
    }

    /** 戳一下：睡着就醒，醒着只算一次互动 */
    @JavascriptInterface
    fun pokePet() {
        main.post { (overlay ?: OverlayPetService.instance)?.pokePet() }
    }

    /** 任何互动（聊天、按按钮）都重置睡觉计时 */
    @JavascriptInterface
    fun markInteraction() {
        main.post { (overlay ?: OverlayPetService.instance)?.markInteraction() }
    }

    @JavascriptInterface
    fun setCentered(value: Boolean) {
        main.post { overlay?.setCentered(value) }
    }

    @JavascriptInterface
    fun setFocusable(value: Boolean) {
        main.post { overlay?.setFocusable(value) }
    }

    /** 网页报上来的可触摸区域，空白处穿透到桌面 */
    @JavascriptInterface
    fun setTouchRects(json: String?) {
        val list = ArrayList<Rect>()
        try {
            val arr = JSONArray(json ?: "[]")
            val d = context.resources.displayMetrics.density
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val l = (o.optDouble("l") * d).roundToInt()
                val t = (o.optDouble("t") * d).roundToInt()
                val r = (o.optDouble("r") * d).roundToInt()
                val b = (o.optDouble("b") * d).roundToInt()
                if (r > l && b > t) list.add(Rect(l, t, r, b))
            }
        } catch (_: Exception) {
        }
        main.post { overlay?.setTouchRects(list) }
    }

    @JavascriptInterface
    fun refreshPet() {
        main.post { overlay?.refresh() }
    }


    @JavascriptInterface
    fun hasOverlayPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(context) else true

    @JavascriptInterface
    fun requestOverlayPermission() {
        main.post {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${context.packageName}")
            )
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    @JavascriptInterface
    fun isRunning(): Boolean = OverlayPetService.isRunning

    @JavascriptInterface
    fun startOverlay() {
        main.post {
            val intent = Intent(context, OverlayPetService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    @JavascriptInterface
    fun stopOverlay() {
        main.post { context.stopService(Intent(context, OverlayPetService::class.java)) }
    }

    @JavascriptInterface
    fun closeOverlay() {
        main.post { overlay?.stopSelf() }
    }

    @JavascriptInterface
    fun toast(msg: String?) {
        main.post { Toast.makeText(context, msg ?: "", Toast.LENGTH_SHORT).show() }
    }

    // ---------- 读屏 / 使用数据 ----------

    /** 读屏 / 使用数据的间隔与概率 */
    @JavascriptInterface
    fun setReadConfig(json: String?) {
        val s = json ?: "{}"
        main.post { (overlay ?: OverlayPetService.instance)?.setReadConfig(s) }
    }

    /** 设置页「立刻测试一次」 */
    @JavascriptInterface
    fun testScreenRead() {
        main.post { (overlay ?: OverlayPetService.instance)?.triggerScreenRead() }
    }

    @JavascriptInterface
    fun testUsageRead() {
        main.post { (overlay ?: OverlayPetService.instance)?.triggerUsageRead() }
    }

    @JavascriptInterface
    fun hasScreenCapture(): Boolean = ScreenConsent.granted

    /** 无障碍服务是否已开（首选截图方式） */
    @JavascriptInterface
    fun hasAccessibility(): Boolean = SansAccessibilityService.ready

    /** 跳到系统无障碍设置页 */
    @JavascriptInterface
    fun openAccessibilitySettings() {
        main.post { ScreenPermission.activity?.openAccessibilitySettings() }
    }

    /** 最近一次截屏失败的原因（空字符串表示没出错） */
    @JavascriptInterface
    fun screenError(): String = ScreenConsent.lastError

    /** 申请截屏授权（会弹系统对话框） */
    @JavascriptInterface
    fun requestScreenCapture() {
        main.post { ScreenPermission.activity?.askScreenCapture() }
    }

    @JavascriptInterface
    fun hasUsageAccess(): Boolean = UsageReader.hasPermission(context)

    /** 跳到系统「使用情况访问」设置页 */
    @JavascriptInterface
    fun openUsageAccessSettings() {
        main.post { ScreenPermission.activity?.openUsageAccessSettings() }
    }

    /** 读最近几分钟用得最多的几个 App，返回 JSON 数组 */
    @JavascriptInterface
    fun readUsage(minutes: Int, limit: Int): String =
        UsageReader.recentApps(context, minutes, limit)

    /** 请求截一帧；结果走 window.__onScreenshot(cbId, ok, base64) */
    @JavascriptInterface
    fun requestScreenshot(callbackId: String?) {
        val cb = callbackId ?: "0"
        main.post { (overlay ?: OverlayPetService.instance)?.captureScreen(cb) }
    }

    // ---------- AI 对话 ----------

    @JavascriptInterface
    fun chat(payloadJson: String?, callbackId: String?) {
        val payload = payloadJson ?: "{}"
        val cb = callbackId ?: "0"
        Thread {
            val result = doChat(payload)
            callJs(
                "window.__sansCallback && window.__sansCallback(" +
                        JSONObject.quote(cb) + "," + JSONObject.quote(result) + ")"
            )
        }.start()
    }

    private fun doChat(payload: String): String {
        var conn: HttpURLConnection? = null
        return try {
            val req = JSONObject(payload)
            val baseUrl = req.optString("baseUrl").trim().trimEnd('/')
            val apiKey = req.optString("apiKey")
            val model = req.optString("model")
            val messages = req.optJSONArray("messages") ?: JSONArray()
            val temperature = req.optDouble("temperature", 0.8)

            if (baseUrl.isEmpty() || model.isEmpty()) {
                return JSONObject().put("ok", false)
                    .put("error", "请先在设置里填写 API 地址和模型").toString()
            }

            val body = JSONObject().apply {
                put("model", model)
                put("messages", messages)
                put("temperature", temperature)
                put("stream", false)
            }

            conn = (URL("$baseUrl/chat/completions").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 20000
                readTimeout = 90000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (apiKey.isNotEmpty()) {
                    setRequestProperty("Authorization", "Bearer $apiKey")
                }
            }

            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }

            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""

            if (code !in 200..299) {
                return JSONObject().put("ok", false)
                    .put("error", "HTTP $code: ${text.take(300)}").toString()
            }

            val content = JSONObject(text)
                .optJSONArray("choices")
                ?.optJSONObject(0)
                ?.optJSONObject("message")
                ?.optString("content")
                .orEmpty()

            if (content.isEmpty()) {
                JSONObject().put("ok", false).put("error", "模型返回为空").toString()
            } else {
                JSONObject().put("ok", true).put("content", content).toString()
            }
        } catch (e: Exception) {
            Log.w("SansPet", "chat failed", e)
            JSONObject().put("ok", false).put("error", e.message ?: "请求失败").toString()
        } finally {
            conn?.disconnect()
        }
    }

    // ---------- 获取模型列表 ----------

    @JavascriptInterface
    fun listModels(payloadJson: String?, callbackId: String?) {
        val payload = payloadJson ?: "{}"
        val cb = callbackId ?: "0"
        Thread {
            val result = doListModels(payload)
            callJs(
                "window.__modelCallback && window.__modelCallback(" +
                        JSONObject.quote(cb) + "," + JSONObject.quote(result) + ")"
            )
        }.start()
    }

    private fun doListModels(payload: String): String {
        var conn: HttpURLConnection? = null
        return try {
            val req = JSONObject(payload)
            val baseUrl = req.optString("baseUrl").trim().trimEnd('/')
            val apiKey = req.optString("apiKey")
            if (baseUrl.isEmpty()) {
                return JSONObject().put("ok", false).put("error", "请先填写 API 地址").toString()
            }

            conn = (URL("$baseUrl/models").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 15000
                readTimeout = 30000
                setRequestProperty("Accept", "application/json")
                if (apiKey.isNotEmpty()) {
                    setRequestProperty("Authorization", "Bearer $apiKey")
                }
            }

            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""

            if (code !in 200..299) {
                return JSONObject().put("ok", false)
                    .put("error", "HTTP $code: ${text.take(200)}").toString()
            }

            val arr = JSONObject(text).optJSONArray("data") ?: JSONArray()
            val models = JSONArray()
            for (i in 0 until arr.length()) {
                val id = arr.optJSONObject(i)?.optString("id").orEmpty()
                if (id.isNotEmpty()) models.put(id)
            }

            if (models.length() == 0) {
                JSONObject().put("ok", false).put("error", "没有拿到模型列表").toString()
            } else {
                JSONObject().put("ok", true).put("models", models).toString()
            }
        } catch (e: Exception) {
            Log.w("SansPet", "listModels failed", e)
            JSONObject().put("ok", false).put("error", e.message ?: "请求失败").toString()
        } finally {
            conn?.disconnect()
        }
    }
}

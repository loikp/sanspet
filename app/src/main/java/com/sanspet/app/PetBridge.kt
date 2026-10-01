package com.sanspet.app

import android.content.Context
import android.content.Intent
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

    @JavascriptInterface
    fun countMessages(): Int = store.countMessages()

    @JavascriptInterface
    fun clearMessages() {
        store.clearMessages()
    }

    // ---------- 悬浮窗 ----------

    @JavascriptInterface
    fun moveBy(dx: Double, dy: Double) {
        main.post { overlay?.moveBy(dx, dy) }
    }

    @JavascriptInterface
    fun savePetPosition() {
        main.post { overlay?.savePosition() }
    }

    @JavascriptInterface
    fun setExpanded(expanded: Boolean) {
        main.post { overlay?.setExpanded(expanded) }
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

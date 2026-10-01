package com.sanspet.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 本地存储：设置 / 记忆 / 完整聊天记录。
 * 用 SharedPreferences 存 JSON，V1 够用，之后可换 Room。
 */
class Store(context: Context) {

    private val sp = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun get(key: String, def: String): String = sp.getString(key, def) ?: def

    fun set(key: String, value: String) {
        sp.edit().putString(key, value).apply()
    }

    @Synchronized
    fun addMessage(json: String) {
        val arr = JSONArray(get(KEY_MESSAGES, "[]"))
        arr.put(JSONObject(json))
        val trimmed = if (arr.length() > MAX_MESSAGES) {
            val out = JSONArray()
            for (i in arr.length() - MAX_MESSAGES until arr.length()) out.put(arr.get(i))
            out
        } else arr
        sp.edit().putString(KEY_MESSAGES, trimmed.toString()).apply()
    }

    /** 从最新往旧分页取，offset=0 是最新一条 */
    @Synchronized
    fun getMessages(offset: Int, limit: Int): String {
        val arr = JSONArray(get(KEY_MESSAGES, "[]"))
        val out = JSONArray()
        var i = arr.length() - 1 - offset
        var n = 0
        while (i >= 0 && n < limit) {
            out.put(arr.get(i))
            i--
            n++
        }
        return out.toString()
    }

    @Synchronized
    fun countMessages(): Int = JSONArray(get(KEY_MESSAGES, "[]")).length()

    fun clearMessages() {
        sp.edit().remove(KEY_MESSAGES).apply()
    }

    companion object {
        private const val PREFS = "sanspet"
        private const val KEY_MESSAGES = "messages"
        private const val MAX_MESSAGES = 2000
    }
}

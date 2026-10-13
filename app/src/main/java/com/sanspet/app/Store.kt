package com.sanspet.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 本地存储。
 *
 * 有两份「对话数据」，故意分开存放：
 *
 *   messages  对话历史 —— 用户能在「对话历史」窗口里翻到的全部记录
 *   memory    上下文记忆 —— 每次请求发给模型的最近 N 条
 *
 * 正常发消息时两份都会写；但用户可以单独清掉其中一份：
 *   清空对话历史 → 只清 messages，模型还记得之前聊过什么
 *   清除记忆     → 只清 memory，历史记录还留着，但模型失忆
 */
class Store(context: Context) {

    private val sp = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun get(key: String, def: String): String = sp.getString(key, def) ?: def

    fun set(key: String, value: String) {
        sp.edit().putString(key, value).apply()
    }

    // ---------- 写入 ----------

    /** 写一条消息：历史和记忆同时写（普通聊天用） */
    @Synchronized
    fun addMessage(json: String) {
        append(KEY_MESSAGES, json)
        append(KEY_MEMORY, json)
    }

    /**
     * 只写对话历史，不写上下文记忆。
     * 戳一戳 / 读屏 / 使用数据 / 睡觉这些「环境行为」的回复走这里 ——
     * 它们能在历史窗口里翻到，但不会污染发给模型的上下文。
     */
    @Synchronized
    fun addMessageOnly(json: String) {
        append(KEY_MESSAGES, json)
    }

    @Synchronized
    private fun append(key: String, json: String) {
        val arr = JSONArray(get(key, "[]"))
        arr.put(JSONObject(json))
        val trimmed = if (arr.length() > MAX_MESSAGES) {
            val out = JSONArray()
            for (i in arr.length() - MAX_MESSAGES until arr.length()) out.put(arr.get(i))
            out
        } else arr
        sp.edit().putString(key, trimmed.toString()).apply()
    }

    // ---------- 读取 ----------

    /** 从最新往旧分页取，offset=0 是最新一条 */
    @Synchronized
    fun getMessages(offset: Int, limit: Int): String = page(KEY_MESSAGES, offset, limit)

    @Synchronized
    fun getMemory(offset: Int, limit: Int): String = page(KEY_MEMORY, offset, limit)

    @Synchronized
    private fun page(key: String, offset: Int, limit: Int): String {
        val arr = JSONArray(get(key, "[]"))
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

    @Synchronized
    fun countMemory(): Int = JSONArray(get(KEY_MEMORY, "[]")).length()

    // ---------- 清除 ----------

    /** 只清对话历史，不动上下文记忆 */
    fun clearMessages() {
        sp.edit().remove(KEY_MESSAGES).apply()
    }

    /** 只清上下文记忆，不动对话历史 */
    fun clearMemory() {
        sp.edit().remove(KEY_MEMORY).apply()
    }

    companion object {
        private const val PREFS = "sanspet"
        private const val KEY_MESSAGES = "messages"
        private const val KEY_MEMORY = "memory"
        private const val MAX_MESSAGES = 2000
    }
}

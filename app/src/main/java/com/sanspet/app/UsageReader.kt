package com.sanspet.app

import android.app.AppOpsManager
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONArray
import org.json.JSONObject

/**
 * 读取「最近用过哪些 App、各用了多久」。
 *
 * 需要在系统设置里手动打开「使用情况访问」权限，否则这里会返回空数组。
 */
object UsageReader {

    /** 是否已经有权限 */
    fun hasPermission(ctx: Context): Boolean {
        return try {
            val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(), ctx.packageName
                )
            } else {
                @Suppress("DEPRECATION")
                appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(), ctx.packageName
                )
            }
            mode == AppOpsManager.MODE_ALLOWED
        } catch (_: Exception) {
            false
        }
    }

    /**
     * 最近 minutes 分钟里用得最久的 limit 个 App。
     * 返回 JSON 数组：[{name, minutes, lastUsedMinAgo}]
     */
    fun recentApps(ctx: Context, minutes: Int = 60, limit: Int = 5): String {
        val out = JSONArray()
        try {
            if (!hasPermission(ctx)) return out.toString()
            val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val end = System.currentTimeMillis()
            val start = end - minutes * 60_000L
            val pm = ctx.packageManager

            val stats: List<UsageStats> =
                usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end) ?: emptyList()

            stats.asSequence()
                .filter { it.lastTimeUsed >= start && it.totalTimeInForeground > 0 }
                .sortedByDescending { it.totalTimeInForeground }
                .take(limit)
                .forEach { s ->
                    val label = try {
                        pm.getApplicationLabel(pm.getApplicationInfo(s.packageName, 0)).toString()
                    } catch (_: Exception) {
                        s.packageName
                    }
                    val o = JSONObject()
                    o.put("name", label)
                    o.put("minutes", (s.totalTimeInForeground / 60000).toInt())
                    o.put("lastUsedMinAgo", ((end - s.lastTimeUsed) / 60000).toInt())
                    out.put(o)
                }
        } catch (_: Exception) {
        }
        return out.toString()
    }
}

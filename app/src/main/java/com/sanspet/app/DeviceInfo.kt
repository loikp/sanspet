package com.sanspet.app

import android.app.KeyguardManager
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import org.json.JSONObject

/**
 * 手机当前状态快照。
 *
 * 这里只负责「如实报数」，一个判断都不做 ——
 * 哪些值得说、多久允许说一次，全部交给 overlay.js 用阈值 + 冷却决定。
 * 原因：全塞给模型它就变成手机播报机器人了。
 *
 * 返回的字段（取不到的字段直接不出现）：
 *   battery     0~100
 *   charging    true / false
 *   screenOn    屏幕亮着吗
 *   locked      锁屏了吗
 *   network     wifi / cellular / other / offline
 *   headset     插着或连着耳机吗
 *   silent      静音或震动吗
 *   foreground  最近切到的应用名（要无障碍开着才有，没开就没有这个字段）
 *
 * 每一块各管各的 try/catch：一项取不到不能连累其他项。
 */
object DeviceInfo {

    fun snapshot(ctx: Context): String {
        val o = JSONObject()

        try {
            val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            if (level in 0..100) o.put("battery", level)
            o.put("charging", isCharging(bm))
        } catch (_: Exception) {
        }

        try {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            o.put("screenOn", pm.isInteractive)
        } catch (_: Exception) {
        }

        try {
            val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            o.put("locked", km.isKeyguardLocked)
        } catch (_: Exception) {
        }

        try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val net = cm.activeNetwork
            val caps = if (net != null) cm.getNetworkCapabilities(net) else null
            o.put(
                "network", when {
                    caps == null -> "offline"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                    else -> "other"
                }
            )
        } catch (_: Exception) {
        }

        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            o.put("headset", hasHeadset(am))
            o.put("silent", am.ringerMode != AudioManager.RINGER_MODE_NORMAL)
        } catch (_: Exception) {
        }

        try {
            val fg = SansAccessibilityService.foregroundApp(ctx)
            if (fg.isNotEmpty()) o.put("foreground", fg)
        } catch (_: Exception) {
        }

        return o.toString()
    }

    /**
     * 在不在充电。
     *
     * 用 BATTERY_PROPERTY_STATUS，不去读 ACTION_BATTERY_CHANGED 那条粘性广播 ——
     * targetSdk 34 之后 registerReceiver 要显式给导出标记，能躲就躲。
     * 设备不支持这个属性时返回 false（当作没在充电），不抛异常。
     */
    private fun isCharging(bm: BatteryManager): Boolean = try {
        val st = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
        st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL
    } catch (_: Exception) {
        false
    }

    /**
     * 有没有插着 / 连着耳机。
     *
     * 不用 isWiredHeadsetOn()：它在 API 26 之后基本恒为 false。
     * 得去问「现在有哪些音频输出设备」才准。
     */
    private fun hasHeadset(am: AudioManager): Boolean = try {
        am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            when (it.type) {
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> true

                else -> false
            }
        }
    } catch (_: Exception) {
        false
    }
}
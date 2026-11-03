package com.example.engagevideopush.push

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.engagelab.privates.common.component.MTCommonReceiver
import com.engagelab.privates.core.api.MTCorePrivatesApi
import com.engagelab.privates.push.api.NotificationMessage
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.MainActivity

class UserReceiver : MTCommonReceiver() {
    override fun onConnectStatus(context: Context, enable: Boolean) {
        val registerCode = runCatching { MTCorePrivatesApi.getRegisterCode(context) }.getOrDefault(-1)
        val loginCode = runCatching { MTCorePrivatesApi.getLoginCode(context) }.getOrDefault(-1)
        Log.i(TAG, "onConnectStatus=$enable registerCode=$registerCode loginCode=$loginCode")
        PushState.connected.value = enable
        PushState.sdkCallback.value = "onConnectStatus($enable) registerCode=$registerCode loginCode=$loginCode"
        if (!enable) {
            val hint = engageLabRegisterHint(context, registerCode)
            PushState.lastError.value = "EngageLab reported onConnectStatus(false). registerCode=$registerCode loginCode=$loginCode. $hint No Registration ID was sent to the backend."
            return
        }
        val registrationId = MTCorePrivatesApi.getRegistrationId(context)
        if (registrationId.isNullOrBlank()) {
            PushState.lastError.value = "onConnectStatus(true), but getRegistrationId is still empty. registerCode=$registerCode loginCode=$loginCode."
            return
        }
        Log.i(TAG, "registrationId length=${registrationId.length}")
        EngageApplication.instance.onRegistrationId(registrationId)
    }

    override fun onNotificationArrived(context: Context, notificationMessage: NotificationMessage) {
        Log.i(TAG, "notification arrived id=${notificationMessage.messageId}")
    }

    override fun onNotificationClicked(context: Context, notificationMessage: NotificationMessage) {
        val parsed = PushPayloadParser.parse(
            messageJson = null,
            extras = bundleToMap(notificationMessage.extras),
            messageId = notificationMessage.messageId,
        )
        Log.i(TAG, "notification clicked videoId=${parsed.videoId}")
        // The SDK may also open MainActivity from intent.url. This launch uses the
        // same extras. MainActivity is the only place that navigates, and the
        // dedupe key ignores message id so the two deliveries count as one open.
        val launch = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("video_id", parsed.videoId)
            putExtra("campaign_id", parsed.campaignId)
            putExtra("category", parsed.category)
            putExtra("message_id", parsed.messageId)
            action = MainActivity.ACTION_OPEN
        }
        context.startActivity(launch)
    }

    private fun bundleToMap(bundle: Bundle?): Map<String, String?> {
        if (bundle == null) return emptyMap()
        return bundle.keySet().associateWith { key -> bundle.getString(key) }
    }

    companion object {
        private const val TAG = "EngagePush"
    }
}

internal fun engageLabRegisterHint(context: Context, registerCode: Int): String {
    val packageName = context.packageName
    return when (registerCode) {
        1005 -> "Code 1005 means this package does not match the AppKey. The installed package is $packageName."
        1008 -> "Code 1008 means EngageLab rejected the AppKey."
        1009 -> "Code 1009 means EngageLab accepted the TCP connection and then refused to create a Registration ID for this AppKey. The installed package is $packageName. In the console, the Android package name for this AppKey must be exactly that value."
        else -> "The SDK did not return a Registration ID."
    }
}

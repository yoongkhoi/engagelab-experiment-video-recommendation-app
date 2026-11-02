package com.example.engagevideopush

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.example.engagevideopush.push.PushNavigator
import com.example.engagevideopush.push.PushPayloadParser
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.ui.EngageApp
import com.example.engagevideopush.ui.theme.EngageTheme

class MainActivity : ComponentActivity() {
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        PushState.permissionGranted.value = granted
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()
        setContent {
            EngageTheme { EngageApp() }
        }
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        (application as EngageApplication).refreshRegistrationId()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val messageJson = intent.getStringExtra("message_json")
            ?: intent.getStringExtra("MTMessageExtra")
            ?: intent.getStringExtra("JMessageExtra")
        val extras = buildMap {
            listOf("video_id", "campaign_id", "category", "msg_id").forEach { key ->
                intent.getStringExtra(key)?.let { put(key, it) }
            }
        }
        val parsed = PushPayloadParser.fromIntentFields(
            intent.action,
            messageJson,
            extras,
            intent.getStringExtra("message_id"),
        ) ?: return
        PushNavigator.offer(parsed)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) {
            PushState.permissionGranted.value = true
            return
        }
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        PushState.permissionGranted.value = granted
        if (!granted) permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    companion object {
        const val ACTION_OPEN = PushPayloadParser.ACTION_OPEN
    }
}

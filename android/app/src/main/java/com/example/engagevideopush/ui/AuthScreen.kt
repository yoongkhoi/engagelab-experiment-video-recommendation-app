package com.example.engagevideopush.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.engagevideopush.EngageApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun AuthScreen(onSignedIn: () -> Unit, onBack: (() -> Unit)? = null, title: String = "Sign in") {
    val app = LocalContext.current.applicationContext as EngageApplication
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val ink = Color.White
    val muted = Color(0xFFB3B3B3)
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedTextColor = ink,
        unfocusedTextColor = ink,
        disabledTextColor = muted,
        focusedLabelColor = Color(0xFFFF5A36),
        unfocusedLabelColor = muted,
        cursorColor = Color(0xFFFF5A36),
        focusedBorderColor = Color(0xFFFF5A36),
        unfocusedBorderColor = Color(0xFF3A3A3A),
    )
    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF121212))
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        onBack?.let { TextButton(onClick = it) { Text("Browse as guest") } }
        Text(title, style = MaterialTheme.typography.headlineMedium, color = ink)
        Text(
            "Use the email address where you can receive a one-time code. A new address creates an account.",
            color = muted,
            modifier = Modifier.padding(vertical = 8.dp),
        )
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !busy, colors = fieldColors)
        if (sent) {
            OutlinedTextField(code, { code = it }, label = { Text("6-digit code") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), singleLine = true, enabled = !busy, colors = fieldColors)
        }
        error?.let { Text(it, color = Color(0xFFFFB4A8), modifier = Modifier.padding(top = 12.dp)) }
        message?.let { Text(it, color = ink, modifier = Modifier.padding(top = 12.dp)) }
        if (busy) CircularProgressIndicator(Modifier.padding(top = 16.dp))
        Button(onClick = {
            scope.launch {
                busy = true
                error = null
                message = null
                try {
                    withContext(Dispatchers.IO) { app.backend.requestCode(email.trim()) }
                    sent = true
                    message = "If that address can receive mail, the code is on its way. It expires in five minutes."
                } catch (reason: Exception) {
                    error = reason.message ?: "The code could not be requested."
                } finally {
                    busy = false
                }
            }
        }, enabled = !busy && email.contains("@"), modifier = Modifier.padding(top = 16.dp)) { Text(if (sent) "Send a new code" else "Email me a code") }
        if (sent) {
            Button(onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        val session = withContext(Dispatchers.IO) { app.backend.verifyCode(email.trim(), code.trim()) }
                        app.session.save(session.token, session.expiresAt)
                        app.backend.sessionToken = session.token
                        app.refreshRegistrationId()
                        onSignedIn()
                    } catch (reason: Exception) {
                        error = reason.message ?: "The code was not accepted."
                    } finally {
                        busy = false
                    }
                }
            }, enabled = !busy && code.length == 6, modifier = Modifier.padding(top = 8.dp)) { Text("Continue") }
        }
    }
}

package com.example.engagevideopush.ui

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Park
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.usableGuestKey
import com.example.engagevideopush.data.BackendException
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.data.VideoJson
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.ui.theme.EngageColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

private data class SuggestedPrompt(val label: String, val text: String, val icon: ImageVector)

internal data class ChatVideo(val item: VideoItem, val reason: String?)

internal data class ChatLine(
    val id: Long,
    val role: String,
    val text: String,
    val prompt: String = "",
    val videos: List<ChatVideo> = emptyList(),
)

private val prompts = listOf(
    SuggestedPrompt("Discover F1 racing videos.", "Discover F1 racing videos.", Icons.Filled.DirectionsCar),
    SuggestedPrompt("Find relaxing nature videos.", "Find relaxing nature videos.", Icons.Filled.Park),
    SuggestedPrompt("Explore food videos.", "Explore food videos.", Icons.Filled.Restaurant),
    SuggestedPrompt("Show me travel adventures.", "Show me travel adventures.", Icons.Filled.Flight),
    SuggestedPrompt("Find technology videos.", "Find technology videos.", Icons.Filled.Memory),
)

internal class AiChatModel : ViewModel() {
    var draft by mutableStateOf("")
    var lines by mutableStateOf(listOf<ChatLine>())
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var copiedId by mutableStateOf<Long?>(null)
    var reactions by mutableStateOf(mapOf<Long, String>())
    private var conversationId: String? = null
    private var generation by mutableIntStateOf(0)
    private val ids = AtomicLong(1)
    private var request: Job? = null

    fun newChat() {
        generation += 1
        request?.cancel()
        request = null
        lines = emptyList()
        conversationId = null
        draft = ""
        error = null
        busy = false
        reactions = emptyMap()
        copiedId = null
    }

    fun stop() {
        request?.cancel()
    }

    fun send(app: EngageApplication, raw: String) {
        val message = raw.trim()
        if (message.isEmpty() || busy) return
        val ticket = generation
        busy = true
        error = null
        draft = ""
        lines = lines + ChatLine(ids.incrementAndGet(), "user", message)
        request = viewModelScope.launch {
            try {
                val guest = app.library.guestKey()
                val body = withContext(Dispatchers.IO) { app.backend.aiChat(message, conversationId, guest) }
                if (ticket != generation) return@launch
                usableGuestKey(body.optString("guestKey"))?.let { app.library.saveGuestKey(it) }
                conversationId = body.optString("conversationId").ifBlank { conversationId }
                lines = lines + ChatLine(
                    ids.incrementAndGet(),
                    "assistant",
                    displayReply(body.optString("reply")),
                    prompt = message,
                    videos = videosOf(body),
                )
            } catch (_: CancellationException) {
                if (ticket == generation) error = "Stopped."
            } catch (reason: Exception) {
                if (ticket == generation) error = chatFailureMessage(reason)
            } finally {
                if (ticket == generation) {
                    busy = false
                    request = null
                }
            }
        }
    }

    fun react(app: EngageApplication, line: ChatLine, sentiment: String) {
        val videoId = line.videos.firstOrNull()?.item?.id ?: return
        viewModelScope.launch {
            val saved = runCatching {
                withContext(Dispatchers.IO) { app.backend.recommendationFeedback(videoId, sentiment, conversationId) }
            }
            if (saved.isSuccess) reactions = reactions + (line.id to sentiment) else error = chatFailureMessage(saved.exceptionOrNull() ?: Exception())
        }
    }
}

@Composable
fun AiScreen(onPlay: (VideoItem, List<VideoItem>) -> Unit, onSignIn: () -> Unit) {
    val context = LocalContext.current
    val app = context.applicationContext as EngageApplication
    val clipboard = LocalClipboardManager.current
    val list = rememberLazyListState()
    val model: AiChatModel = viewModel()
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
    var ready by remember { mutableStateOf<Boolean?>(null) }
    val density = LocalDensity.current
    val imeBottom = WindowInsets.ime.getBottom(density)
    val draft = model.draft
    val lines = model.lines
    val busy = model.busy
    val error = model.error

    LaunchedEffect(Unit) {
        ready = withContext(Dispatchers.IO) { runCatching { app.backend.health().optBoolean("ok") }.getOrNull() }
    }
    LaunchedEffect(lines.size, busy, imeBottom) {
        if (lines.isNotEmpty()) list.animateScrollToItem(lines.lastIndex)
    }

    Column(Modifier.fillMaxSize().background(EngageColors.background).imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(EngageColors.surface),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.AutoAwesome, "Video Assistant", tint = EngageColors.accent)
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text("Video Assistant", color = EngageColors.text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Discover videos with AI", color = EngageColors.muted, style = MaterialTheme.typography.bodySmall)
                if (ready != null) {
                    Text(if (ready == true) "Ready" else "Offline", color = if (ready == true) Color(0xFF1DB954) else EngageColors.muted, style = MaterialTheme.typography.labelSmall)
                }
            }
            IconButton(onClick = { model.newChat() }) { Icon(Icons.Filled.Add, "New chat", tint = EngageColors.text) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More options", tint = EngageColors.text) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("New chat") }, onClick = { menu = false; model.newChat() })
                    if (!signedIn) DropdownMenuItem(text = { Text("Sign in") }, onClick = { menu = false; onSignIn() })
                }
            }
        }
        LazyColumn(
            state = list,
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (lines.isEmpty()) {
                item {
                    Welcome(onPrompt = { model.send(app, it) })
                }
            }
            items(lines, key = { it.id }) { line ->
                var appear by remember(line.id) { mutableStateOf(false) }
                LaunchedEffect(line.id) { appear = true }
                AnimatedVisibility(visible = appear, enter = fadeIn() + slideInVertically { it / 5 }) {
                    if (line.role == "user") UserBubble(line.text) else AssistantBubble(
                        line = line,
                        reaction = model.reactions[line.id],
                        copied = model.copiedId == line.id,
                        onCopy = {
                            clipboard.setText(AnnotatedString(line.text))
                            model.copiedId = line.id
                        },
                        onRetry = { model.send(app, line.prompt) },
                        onReact = { sentiment ->
                            if (!signedIn) onSignIn() else model.react(app, line, sentiment)
                        },
                        onShare = { share(context, line.text) },
                        onPlay = { video -> onPlay(video, line.videos.map { it.item }) },
                        onShareVideo = { video ->
                            val page = video.sourceUrl?.takeIf { it.startsWith("https://") }
                            val clip = video.source.takeIf { it.startsWith("https://") }
                            share(context, listOf(video.title, page ?: clip).filter { !it.isNullOrBlank() }.joinToString("\n"))
                        },
                    )
                }
            }
            if (busy) {
                item { Text("Looking through Pixabay…", color = EngageColors.muted, style = MaterialTheme.typography.bodyMedium) }
            }
            error?.let { message ->
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        val retryPrompt = lines.lastOrNull { it.role == "user" }?.text.orEmpty()
                        if (retryPrompt.isNotBlank()) {
                            IconButton(onClick = { model.send(app, retryPrompt) }) { Icon(Icons.Filled.Refresh, "Retry", tint = EngageColors.text) }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
        Composer(
            draft = draft,
            busy = busy,
            onDraft = { if (it.length <= 1000) model.draft = it },
            onSend = { model.send(app, draft) },
            onStop = { model.stop() },
        )
    }
}

@Composable
private fun Welcome(onPrompt: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 12.dp)) {
        Text("Find a video by describing it.", color = EngageColors.text, style = MaterialTheme.typography.headlineSmall)
        Text(
            "Ask for racing, nature, food, travel, technology, or any other topic. Playable results come from Pixabay.",
            color = EngageColors.muted,
            style = MaterialTheme.typography.bodyMedium,
        )
        prompts.forEach { prompt ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(EngageColors.surface).clickable { onPrompt(prompt.text) }.padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(prompt.icon, null, tint = EngageColors.accent, modifier = Modifier.size(22.dp))
                Text(prompt.label, color = EngageColors.text, modifier = Modifier.padding(start = 12.dp), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Text(
            text,
            color = EngageColors.text,
            modifier = Modifier.widthIn(max = (LocalConfiguration.current.screenWidthDp * 0.78f).dp).clip(RoundedCornerShape(18.dp)).background(Color(0xFF3A2420)).padding(horizontal = 14.dp, vertical = 10.dp),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

@Composable
private fun AssistantBubble(
    line: ChatLine,
    reaction: String?,
    copied: Boolean,
    onCopy: () -> Unit,
    onRetry: () -> Unit,
    onReact: (String) -> Unit,
    onShare: () -> Unit,
    onPlay: (VideoItem) -> Unit,
    onShareVideo: (VideoItem) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(28.dp).clip(CircleShape).background(EngageColors.surface), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.AutoAwesome, "Video Assistant", tint = EngageColors.accent, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.padding(start = 8.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FormattedReply(line.text)
            Row {
                IconButton(onClick = onCopy) { Icon(Icons.Filled.ContentCopy, if (copied) "Copied" else "Copy", tint = EngageColors.muted) }
                if (line.prompt.isNotBlank()) IconButton(onClick = onRetry) { Icon(Icons.Filled.Refresh, "Retry", tint = EngageColors.muted) }
                if (line.videos.isNotEmpty()) {
                    IconButton(onClick = { onReact("positive") }) { Icon(Icons.Filled.ThumbUp, "Like", tint = if (reaction == "positive") EngageColors.accent else EngageColors.muted) }
                    IconButton(onClick = { onReact("negative") }) { Icon(Icons.Filled.ThumbDown, "Dislike", tint = if (reaction == "negative") EngageColors.accent else EngageColors.muted) }
                }
                IconButton(onClick = onShare) { Icon(Icons.Filled.Share, "Share", tint = EngageColors.muted) }
            }
            line.videos.forEach { video ->
                VideoRecommendationCard(video, onPlay = { onPlay(video.item) }, onShare = { onShareVideo(video.item) })
            }
        }
    }
}

@Composable
private fun FormattedReply(text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        text.replace("\r\n", "\n").split("\n\n").forEach { block ->
            block.lines().filter { it.isNotBlank() }.forEach { row ->
                val trimmed = row.trim()
                val bullet = trimmed.startsWith("- ") || trimmed.startsWith("* ") || Regex("^\\d+\\.\\s+").containsMatchIn(trimmed)
                val body = trimmed.removePrefix("- ").removePrefix("* ").replace(Regex("^\\d+\\.\\s+"), "")
                Text(if (bullet) "• $body" else body, color = EngageColors.text, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
private fun VideoRecommendationCard(video: ChatVideo, onPlay: () -> Unit, onShare: () -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    val scope = rememberCoroutineScope()
    val signedIn by PushState.authenticated.collectAsStateWithLifecycle()
    var saved by remember(video.item.id) { mutableStateOf(false) }
    LaunchedEffect(video.item.id) { saved = app.library.isFavorite(video.item.id) }
    val item = video.item
    val thumb = item.thumbnailUrl?.takeIf { it.startsWith("https://") }
    val duration = durationLabel(item.durationSeconds)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFF1C1C1C)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(168.dp).clip(RoundedCornerShape(12.dp)).background(EngageColors.surface).clickable(onClick = onPlay)) {
            if (thumb != null) {
                AsyncImage(model = thumb, contentDescription = item.title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Icon(Icons.Filled.PlayArrow, null, tint = EngageColors.muted, modifier = Modifier.align(Alignment.Center).size(36.dp))
            }
            if (duration != null) {
                Text(duration, color = EngageColors.text, modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xCC121212)).padding(horizontal = 6.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall)
            }
        }
        Text(item.title, color = EngageColors.text, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
        Text(
            if (item.creatorName.isNullOrBlank()) "Pixabay" else "Video by ${item.creatorName} on Pixabay",
            color = EngageColors.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        video.reason?.let { Text(it, color = EngageColors.muted, style = MaterialTheme.typography.bodySmall) }
        Row {
            IconButton(onClick = onPlay) { Icon(Icons.Filled.PlayArrow, "Play", tint = EngageColors.text) }
            IconButton(onClick = {
                scope.launch {
                    saved = app.library.toggleFavorite(item.id)
                    if (signedIn && app.backend.sessionToken != null) {
                        runCatching {
                            withContext(Dispatchers.IO) {
                                if (saved) app.backend.saveFavorite(item) else app.backend.deleteFavorite(item.id)
                            }
                        }
                    }
                }
            }) { Icon(if (saved) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, "Favorite", tint = if (saved) EngageColors.accent else EngageColors.text) }
            if (item.source.startsWith("https://") || item.sourceUrl?.startsWith("https://") == true) {
                IconButton(onClick = onShare) { Icon(Icons.Filled.Share, "Share video", tint = EngageColors.text) }
            }
        }
    }
}

@Composable
private fun Composer(draft: String, busy: Boolean, onDraft: (String) -> Unit, onSend: () -> Unit, onStop: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp).clip(RoundedCornerShape(28.dp)).background(EngageColors.surface).padding(start = 8.dp, end = 4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        TextField(
            value = draft,
            onValueChange = onDraft,
            modifier = Modifier.weight(1f),
            placeholder = { Text("Message", color = EngageColors.muted) },
            minLines = 1,
            maxLines = 5,
            enabled = !busy,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                disabledContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                cursorColor = EngageColors.accent,
                focusedTextColor = EngageColors.text,
                unfocusedTextColor = EngageColors.text,
            ),
        )
        if (busy) {
            IconButton(onClick = onStop) { Icon(Icons.Filled.Stop, "Stop", tint = EngageColors.text) }
        } else {
            IconButton(onClick = onSend, enabled = draft.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = if (draft.isNotBlank()) EngageColors.accent else EngageColors.muted) }
        }
    }
}

internal fun chatFailureMessage(error: Throwable): String {
    val raw = error.message.orEmpty()
    val failure = error as? BackendException
    val code = failure?.code ?: 0
    if (code == 400 || raw.contains("Request validation failed", ignoreCase = true)) {
        return "That message could not be sent. Try describing the videos you want."
    }
    if (code == 429) return "Too many requests. Wait a moment and try again."
    if (code == 504 || raw.contains("timed out", ignoreCase = true)) return "The video assistant timed out. Try again."
    if (raw.contains("Video search is unavailable", ignoreCase = true) || raw.contains("Pixabay", ignoreCase = true)) {
        return "Video search is unavailable right now."
    }
    if (code == 502 || code == 503 || failure?.network == true) return "The video assistant is unavailable right now."
    if (raw.contains("Traceback") || raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
        return "The video assistant could not answer. Try again."
    }
    return raw.ifBlank { "The video assistant did not answer." }
}

private fun displayReply(text: String): String {
    val trimmed = text.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "I could not format that reply. Try again."
    return text.ifBlank { "Pixabay did not return a playable video for that request." }
}

private fun videosOf(body: JSONObject): List<ChatVideo> {
    val array = body.optJSONArray("videos") ?: return emptyList()
    return buildList {
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val title = item.optString("title").trim()
            val source = item.optString("videoUrl").ifBlank { item.optString("video_url") }.ifBlank { item.optString("source") }
            if (title.isEmpty() || !source.startsWith("https://")) continue
            if (item.optString("video_url").isBlank()) item.put("video_url", source)
            if (item.optString("source").isBlank()) item.put("source", source)
            val parsed = VideoJson.parse(item) ?: continue
            val thumb = parsed.thumbnailUrl?.takeIf { it.startsWith("https://") }
            add(ChatVideo(parsed.copy(title = title, source = source, thumbnailUrl = thumb), item.optString("reason").ifBlank { null }))
        }
    }
}

private fun durationLabel(seconds: Int?): String? {
    if (seconds == null || seconds < 0) return null
    return "%d:%02d".format(seconds / 60, seconds % 60)
}

private fun share(context: android.content.Context, text: String) {
    if (text.isBlank()) return
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, null))
}

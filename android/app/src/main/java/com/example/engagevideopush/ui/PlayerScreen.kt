package com.example.engagevideopush.ui

import android.app.Activity
import android.view.ViewGroup
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.playback.PlaybackSession
import com.example.engagevideopush.playback.playerAspectRatio
import com.example.engagevideopush.push.PushState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    videoId: String,
    campaignId: String?,
    category: String?,
    playlistIds: List<String>,
    playlistVideos: List<VideoItem>,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as EngageApplication
    val configuration = LocalConfiguration.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val session = remember { PlaybackSession().also { it.attachPlayer() } }
    val player = remember { ExoPlayer.Builder(context).build() }
    val clips = remember(videoId, playlistIds) { playlistVideos }
    var video by remember { mutableStateOf<VideoItem?>(null) }
    var metadataError by remember { mutableStateOf<String?>(null) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var lookupAttempt by remember { mutableIntStateOf(0) }
    var preparedKey by remember { mutableStateOf<String?>(null) }
    var fullscreen by remember { mutableStateOf(false) }
    var aspect by remember { mutableFloatStateOf(16f / 9f) }
    val opened = remember { mutableSetOf<String>() }
    val started = remember { mutableSetOf<String>() }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val id = mediaItem?.mediaId ?: return
                val match = clips.find { it.id == id }
                if (match != null) video = match
                playbackError = null
                if (match != null && opened.add(id)) {
                    val playbackCampaign = if (id == videoId) campaignId else null
                    val playbackCategory = if (id == videoId) category else match.category
                    app.scope.launch { postPlayback(app, "video_opened", match, playbackCampaign, playbackCategory) }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) session.play() else session.pause()
                val current = video
                if (isPlaying && current != null && started.add(current.id)) {
                    val playbackCampaign = if (current.id == videoId) campaignId else null
                    val playbackCategory = if (current.id == videoId) category else current.category
                    app.scope.launch { postPlayback(app, "video_play_started", current, playbackCampaign, playbackCategory) }
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) playbackError = null
                val current = video
                if (playbackState == Player.STATE_ENDED && current != null) {
                    session.markEnded()
                    val playbackCampaign = if (current.id == videoId) campaignId else null
                    val playbackCategory = if (current.id == videoId) category else current.category
                    app.scope.launch { postPlayback(app, "video_play_completed", current, playbackCampaign, playbackCategory) }
                }
            }

            override fun onVideoSizeChanged(videoSize: VideoSize) {
                aspect = playerAspectRatio(videoSize.width, videoSize.height)
            }

            override fun onPlayerError(playbackErrorEvent: PlaybackException) {
                val message = playbackErrorEvent.message ?: "Playback failed. Check the network and try again."
                session.fail(message)
                playbackError = message
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    DisposableEffect(lifecycleOwner, player) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) player.pause()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(videoId, lookupAttempt) {
        loading = true
        metadataError = null
        val resolved = withContext(Dispatchers.IO) { app.repository.resolve(videoId) }
        loading = false
        if (resolved == null) {
            metadataError = "Video $videoId was not found in the backend or the bundled catalogue."
            return@LaunchedEffect
        }
        video = resolved
        val ordered = orderedClips(clips, resolved)
        val items = ordered.mapNotNull { item ->
            val uri = app.repository.playbackUri(item) ?: return@mapNotNull null
            MediaItem.Builder().setMediaId(item.id).setUri(uri).build()
        }
        if (items.isEmpty()) {
            metadataError = "No playable source for ${resolved.id}."
            return@LaunchedEffect
        }
        val playbackCampaign = campaignId
        val playbackCategory = category ?: resolved.category
        if (opened.add(resolved.id)) {
            postPlayback(app, "video_opened", resolved, playbackCampaign, playbackCategory)
        }
        val key = items.joinToString(",") { it.mediaId } + "#$lookupAttempt"
        if (preparedKey == key && player.playbackState != Player.STATE_IDLE) return@LaunchedEffect
        val index = items.indexOfFirst { it.mediaId == resolved.id }.coerceAtLeast(0)
        session.open(resolved.id)
        player.setMediaItems(items, index, 0L)
        player.prepare()
        player.playWhenReady = true
        preparedKey = key
        playbackError = null
    }

    val view = LocalView.current
    SideEffect {
        val window = (view.context as Activity).window
        val controller = WindowCompat.getInsetsController(window, view)
        WindowCompat.setDecorFitsSystemWindows(window, !fullscreen)
        if (fullscreen) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }
    val maxHeight = (configuration.screenHeightDp * if (aspect < 1f) 0.72f else 0.5f).dp
    val playerModifier = if (fullscreen) {
        Modifier.fillMaxSize()
    } else {
        Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(max = maxHeight).aspectRatio(aspect)
    }
    val playerView: @Composable () -> Unit = {
        Box(playerModifier) {
            AndroidView(
                factory = { viewContext ->
                    PlayerView(viewContext).apply {
                        this.player = player
                        useController = true
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        )
                    }
                },
                update = { surface ->
                    surface.player = player
                    surface.useController = true
                    surface.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                },
                modifier = Modifier.fillMaxSize(),
            )
            IconButton(onClick = { fullscreen = !fullscreen }, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(
                    if (fullscreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                    contentDescription = if (fullscreen) "Exit fullscreen" else "Fullscreen",
                    tint = Color.White,
                )
            }
        }
    }
    if (fullscreen) {
        Box(Modifier.fillMaxSize().background(Color.Black)) { playerView() }
        return
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Button(onClick = onBack) { Text("Back") }
        Text(video?.title ?: "Video $videoId", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(vertical = 8.dp))
        Text(video?.category.orEmpty())
        val creator = video?.creatorName
        if (!creator.isNullOrBlank()) {
            TextButton(onClick = { openHttps(context, video?.sourceUrl ?: video?.creatorProfileUrl) }) {
                Text("Video by $creator on Pixabay")
            }
        }
        playerView()
        if (loading) Text("Opening video…", modifier = Modifier.padding(top = 8.dp))
        metadataError?.let { message ->
            Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
            Button(onClick = { lookupAttempt += 1 }, modifier = Modifier.padding(top = 8.dp)) { Text("Retry") }
        }
        playbackError?.let { message ->
            Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
            Button(onClick = {
                val position = player.currentPosition.coerceAtLeast(0)
                if (!session.retry()) return@Button
                player.seekTo(position)
                player.prepare()
                player.play()
                playbackError = null
            }, modifier = Modifier.padding(top = 8.dp)) { Text("Retry") }
        }
    }
}

private fun orderedClips(clips: List<VideoItem>, current: VideoItem): List<VideoItem> {
    if (clips.isEmpty()) return listOf(current)
    val replaced = clips.map { if (it.id == current.id) current else it }
    return if (replaced.any { it.id == current.id }) replaced else listOf(current) + replaced
}

@Composable
fun MissingVideoScreen(onBack: () -> Unit) {
    Column(Modifier.padding(24.dp)) {
        Text("This notification did not include a valid video id.", style = MaterialTheme.typography.titleLarge)
        Text(PushState.lastError.value ?: "Open the feed and choose a video.", modifier = Modifier.padding(vertical = 12.dp))
        Button(onClick = onBack) { Text("Back to feed") }
    }
}

private suspend fun postPlayback(
    app: EngageApplication,
    eventType: String,
    video: VideoItem,
    campaignId: String?,
    category: String?,
) {
    val token = app.preferences.deviceToken() ?: return
    val registrationId = PushState.registrationId.value
    if (registrationId.isBlank()) return
    val event = JSONObject()
        .put("eventType", eventType)
        .put("registrationId", registrationId)
        .put("videoId", video.id)
        .put("dedupeKey", "$eventType:$registrationId:${campaignId ?: "manual"}:${video.id}")
    if (!campaignId.isNullOrBlank()) event.put("campaignId", campaignId)
    if (!category.isNullOrBlank()) event.put("metadata", JSONObject().put("category", category))
    try {
        app.backend.postEvent(token, event)
    } catch (_: Exception) {
        PushState.lastError.value = "The video opened, but the playback event could not be saved."
    }
}

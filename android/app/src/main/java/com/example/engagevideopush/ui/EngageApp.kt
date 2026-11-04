package com.example.engagevideopush.ui

import android.app.Application
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.engagevideopush.EngageApplication
import com.example.engagevideopush.data.BackendException
import com.example.engagevideopush.data.DiscoverRails
import com.example.engagevideopush.data.FeedCategories
import com.example.engagevideopush.data.FeedResult
import com.example.engagevideopush.data.VideoItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import com.example.engagevideopush.push.PushNavigator
import com.example.engagevideopush.push.PushPayloadParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

class FeedViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as EngageApplication
    private val _state = MutableStateFlow<FeedUiState>(FeedUiState.Loading)
    val state: StateFlow<FeedUiState> = _state
    private val _category = MutableStateFlow(FeedCategories.all.first())
    val category: StateFlow<FeedCategories.Item> = _category
    private var page = 1
    private var appliedPreference = false

    fun select(item: FeedCategories.Item) {
        _category.value = item
        page = 1
        load()
    }

    fun nextPage() {
        page += 1
        load()
    }

    fun load() {
        val requestedPage = page
        _state.value = FeedUiState.Loading
        viewModelScope.launch {
            if (!appliedPreference && requestedPage == 1 && app.backend.sessionToken != null) {
                appliedPreference = true
                val preferred = runCatching { withContext(Dispatchers.IO) { app.backend.videoPreferences() } }.getOrNull()
                val match = com.example.engagevideopush.data.FeedCategories.all.firstOrNull { item ->
                    item.query != null && preferred?.contains(item.query) == true
                }
                if (match != null) _category.value = match
            }
            val active = _category.value
            val result = withContext(Dispatchers.IO) { app.repository.loadFeed(active, requestedPage) }
            _state.value = when {
                result.videos.isEmpty() && !result.offline -> FeedUiState.Empty
                result.videos.isEmpty() -> FeedUiState.Failed(result.message ?: "Videos could not be loaded.")
                else -> FeedUiState.Ready(result)
            }
        }
    }
}

sealed interface FeedUiState {
    data object Loading : FeedUiState
    data object Empty : FeedUiState
    data class Failed(val message: String) : FeedUiState
    data class Ready(val result: FeedResult) : FeedUiState
}

object PlaybackQueue {
    var videos: List<VideoItem> = emptyList()
}

private val tabs = listOf("home", "search", "ai", "profile")

@Composable
fun EngageApp() {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val push by PushNavigator.target.collectAsStateWithLifecycle()
    val app = androidx.compose.ui.platform.LocalContext.current.applicationContext as EngageApplication
    var booting by remember { mutableStateOf(true) }

    LaunchedEffect(push) {
        val target = push ?: return@LaunchedEffect
        booting = false
        val destination = PushPayloadParser.routeFor(target)
        if (destination == "missing") {
            nav.navigate("missing") { launchSingleTop = true }
        } else {
            nav.navigate(destination) { launchSingleTop = true }
            app.scope.launch { recordOpen(app, target.videoId ?: return@launch, target.campaignId, target.category) }
        }
        PushNavigator.consume()
    }

    val signedIn by com.example.engagevideopush.push.PushState.authenticated.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) {
        val token = app.session.token()
        com.example.engagevideopush.push.PushState.authenticated.value = token != null
        if (token != null) {
            for (attempt in 1..15) {
                if (app.backend.baseUrl.isNotBlank()) {
                    val failure = withContext(Dispatchers.IO) { runCatching { app.backend.currentUser() }.exceptionOrNull() }
                    if (failure is BackendException && failure.code == 401) {
                        app.session.clear()
                        app.backend.sessionToken = null
                        com.example.engagevideopush.push.PushState.authenticated.value = false
                    }
                    break
                }
                delay(200)
            }
        }
        delay(500)
        booting = false
    }
    LaunchedEffect(signedIn) {
        if (!signedIn) return@LaunchedEffect
        app.scope.launch {
            val favorites = runCatching { app.backend.favorites() }.getOrNull()
            val history = runCatching { app.backend.history() }.getOrNull()
            if (favorites != null) app.library.replaceFavorites(favorites)
            if (history != null) app.library.replaceWatched(history)
        }
    }
    fun openVideo(video: VideoItem, queue: List<VideoItem>) {
        PlaybackQueue.videos = queue
        val category = android.net.Uri.encode(video.category)
        nav.navigate("player/${video.id}?campaignId=&category=$category") { launchSingleTop = true }
    }
    fun openAuth(mode: String) {
        nav.navigate("auth/$mode") { launchSingleTop = true }
    }
    fun openTab(tab: String) {
        nav.navigate(tab) {
            popUpTo("home") { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
    val showBar = route in tabs
    Box(Modifier.fillMaxSize()) {
        Scaffold(
            bottomBar = {
                if (showBar) {
                    NavigationBar {
                        NavigationBarItem(selected = route == "home", onClick = { openTab("home") }, icon = { Icon(Icons.Default.Home, null) }, label = { Text("Home") })
                        NavigationBarItem(selected = route == "search", onClick = { openTab("search") }, icon = { Icon(Icons.Default.Search, null) }, label = { Text("Search") })
                        NavigationBarItem(selected = route == "ai", onClick = { openTab("ai") }, icon = { Icon(Icons.Default.AutoAwesome, null) }, label = { Text("AI") })
                        NavigationBarItem(selected = route == "profile", onClick = { openTab("profile") }, icon = { Icon(Icons.Default.Person, null) }, label = { Text("Profile") })
                    }
                }
            },
        ) { padding ->
            NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding)) {
                composable("home") { HomeScreen(onPlay = ::openVideo, onOpenRail = { nav.navigate("category/${it.query}") }, onProfile = { openTab("profile") }) }
                composable("search") { SearchScreen(onPlay = ::openVideo, onOpenRail = { nav.navigate("category/${it.query}") }) }
                composable("ai") { AiScreen(onPlay = ::openVideo, onSignIn = { openAuth("sign-in") }) }
                composable("profile") {
                    ProfileScreen(
                        onSignIn = { openAuth("sign-in") },
                        onCreateAccount = { openAuth("create") },
                        onFavorites = { nav.navigate("favorites") },
                        onWatched = { nav.navigate("watched") },
                        onInterests = { if (signedIn) nav.navigate("preferences") else openAuth("sign-in") },
                        onSettings = { nav.navigate("settings") },
                        onDevices = { nav.navigate("devices") },
                        onEditProfile = { if (signedIn) nav.navigate("account") else openAuth("sign-in") },
                        onNotifications = { nav.navigate("notifications") },
                    )
                }
                composable("category/{query}") { entry ->
                    CategoryScreen(entry.arguments?.getString("query").orEmpty(), onPlay = ::openVideo)
                }
                composable("auth/{title}") { entry ->
                    AuthScreen(
                        title = if (entry.arguments?.getString("title") == "create") "Create account" else "Sign in",
                        onBack = { nav.popBackStack() },
                        onSignedIn = {
                            com.example.engagevideopush.push.PushState.authenticated.value = true
                            app.scope.launch { PendingLibrary.apply(app) }
                            nav.popBackStack()
                        },
                    )
                }
                composable(
                    "player/{videoId}?campaignId={campaignId}&category={category}",
                    arguments = listOf(
                        navArgument("videoId") { type = NavType.StringType },
                        navArgument("campaignId") { type = NavType.StringType; defaultValue = "" },
                        navArgument("category") { type = NavType.StringType; defaultValue = "" },
                    ),
                ) { entry ->
                    PlayerScreen(
                        videoId = entry.arguments?.getString("videoId").orEmpty(),
                        campaignId = entry.arguments?.getString("campaignId").orEmpty().ifBlank { null },
                        category = entry.arguments?.getString("category").orEmpty().ifBlank { null },
                        playlistIds = PlaybackQueue.videos.map { it.id },
                        playlistVideos = PlaybackQueue.videos,
                        onBack = { if (!nav.popBackStack()) openTab("home") },
                        onSignIn = { openAuth("sign-in") },
                    )
                }
                composable("settings") {
                    SettingsScreen(
                        onAccount = { nav.navigate("account") },
                        onInterests = { if (signedIn) nav.navigate("preferences") else openAuth("sign-in") },
                        onNotifications = { nav.navigate("notifications") },
                        onPlayback = { nav.navigate("playback") },
                        onDevices = { nav.navigate("devices") },
                        onPrivacy = { nav.navigate("privacy") },
                        onAbout = { nav.navigate("about") },
                    )
                }
                composable("account") { AccountSettingsScreen(onSignIn = { openAuth("sign-in") }) }
                composable("preferences") { if (signedIn) PreferencesScreen() else AuthScreen(onBack = { nav.popBackStack() }, onSignedIn = { com.example.engagevideopush.push.PushState.authenticated.value = true; nav.popBackStack() }) }
                composable("notifications") { NotificationSettingsScreen(onDevices = { nav.navigate("device") }, onSignIn = { openAuth("sign-in") }) }
                composable("playback") { PlaybackSettingsScreen() }
                composable("devices") { MyDevicesScreen { nav.navigate("device") } }
                composable("device") { DeviceScreen() }
                composable("privacy") { PrivacyScreen() }
                composable("about") { AboutScreen() }
                composable("favorites") { LibraryListScreen("My Favorites", "You have not saved a video yet.", favorite = true, onPlay = ::openVideo, onSignIn = { openAuth("sign-in") }) }
                composable("watched") { LibraryListScreen("Recently Watched", "Videos you watch on this device will appear here.", favorite = false, onPlay = ::openVideo, onSignIn = { openAuth("sign-in") }) }
                composable("missing") { MissingVideoScreen { if (!nav.popBackStack()) openTab("home") } }
            }
        }
        if (booting) SplashScreen()
    }
}

private suspend fun recordOpen(app: EngageApplication, videoId: String, campaignId: String?, category: String?) {
    val token = app.preferences.deviceToken() ?: return
    val registrationId = com.example.engagevideopush.push.PushState.registrationId.value
    if (registrationId.isBlank()) return
    val event = JSONObject()
        .put("eventType", "notification_opened")
        .put("registrationId", registrationId)
        .put("videoId", videoId)
        .put("dedupeKey", "notification_opened:$registrationId:${campaignId ?: videoId}")
    if (!campaignId.isNullOrBlank()) event.put("campaignId", campaignId)
    if (!category.isNullOrBlank()) event.put("metadata", JSONObject().put("category", category))
    try {
        app.backend.postEvent(token, event)
    } catch (_: Exception) {
        // Playback can continue when analytics are temporarily unreachable.
    }
}

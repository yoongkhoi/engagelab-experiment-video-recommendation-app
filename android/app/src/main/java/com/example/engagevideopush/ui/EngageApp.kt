package com.example.engagevideopush.ui

import android.app.Application
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import com.example.engagevideopush.data.FeedCategories
import com.example.engagevideopush.data.FeedResult
import kotlinx.coroutines.Dispatchers
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
        val selected = _category.value
        val requestedPage = page
        _state.value = FeedUiState.Loading
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { app.repository.loadFeed(selected, requestedPage) }
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

@Composable
fun EngageApp(feedViewModel: FeedViewModel = viewModel()) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val push by PushNavigator.target.collectAsStateWithLifecycle()
    val app = androidx.compose.ui.platform.LocalContext.current.applicationContext as EngageApplication

    LaunchedEffect(Unit) { feedViewModel.load() }
    LaunchedEffect(push) {
        val target = push ?: return@LaunchedEffect
        val destination = PushPayloadParser.routeFor(target)
        if (destination == "missing") {
            nav.navigate("missing") { launchSingleTop = true }
        } else {
            nav.navigate(destination) { launchSingleTop = true }
            app.scope.launch { recordOpen(app, target.videoId ?: return@launch, target.campaignId, target.category) }
        }
        PushNavigator.consume()
    }

    val feed by feedViewModel.state.collectAsStateWithLifecycle()
    val playlistIds = (feed as? FeedUiState.Ready)?.result?.videos?.map { it.id }.orEmpty()
    val showBar = route == null || route == "feed" || route == "preferences" || route == "device"
    Scaffold(
        bottomBar = {
            if (showBar) {
                NavigationBar {
                    NavigationBarItem(selected = route == "feed", onClick = { nav.navigate("feed") { launchSingleTop = true } }, icon = { Icon(Icons.Default.Home, null) }, label = { Text("Feed") })
                    NavigationBarItem(selected = route == "preferences", onClick = { nav.navigate("preferences") { launchSingleTop = true } }, icon = { Icon(Icons.Default.Settings, null) }, label = { Text("Preferences") })
                    NavigationBarItem(selected = route == "device", onClick = { nav.navigate("device") { launchSingleTop = true } }, icon = { Icon(Icons.Default.Smartphone, null) }, label = { Text("Device") })
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "feed", modifier = Modifier.padding(padding)) {
            composable("feed") { FeedScreen(feedViewModel) { id -> nav.navigate("player/$id?campaignId=&category=") } }
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
                    playlistIds = playlistIds,
                    playlistVideos = (feed as? FeedUiState.Ready)?.result?.videos.orEmpty(),
                    onBack = { nav.popBackStack() },
                )
            }
            composable("preferences") { PreferencesScreen() }
            composable("device") { DeviceScreen() }
            composable("missing") { MissingVideoScreen { nav.popBackStack() } }
        }
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

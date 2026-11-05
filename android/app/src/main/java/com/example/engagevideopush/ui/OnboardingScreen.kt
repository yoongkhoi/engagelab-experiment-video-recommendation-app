package com.example.engagevideopush.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.engagevideopush.EngageApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class InterestChoice(val id: String, val label: String, val suggestions: List<String>)

val interestChoices = listOf(
    InterestChoice("nature", "Nature", listOf("Waterfalls", "Mountains", "Wildlife", "Ocean")),
    InterestChoice("travel", "Travel", listOf("Cities", "Road trips", "Beaches")),
    InterestChoice("food", "Food", listOf("Street Food", "Cooking", "Desserts", "Restaurants")),
    InterestChoice("technology", "Technology", listOf("Gadgets", "Software")),
    InterestChoice("sports", "Sports", listOf("Football", "Outdoor sports")),
    InterestChoice("motorsport", "Motorsport & Cars", listOf("Formula 1", "Motorsport", "Supercars", "Automotive Technology")),
    InterestChoice("animals", "Animals", listOf("Pets", "Wildlife")),
    InterestChoice("entertainment", "Movies & Entertainment", listOf("Film", "Stories")),
    InterestChoice("music", "Music", listOf("Performance", "Concerts")),
    InterestChoice("fashion", "Fashion & Beauty", listOf("Fashion", "Skincare", "Makeup", "Design")),
    InterestChoice("design", "Design & Art", listOf("Illustration", "Interiors")),
    InterestChoice("gaming", "Gaming", listOf("Gameplay", "Esports")),
    InterestChoice("science", "Science & Education", listOf("Experiments", "Space")),
    InterestChoice("lifestyle", "Lifestyle", listOf("Daily life", "Home")),
    InterestChoice("fitness", "Fitness", listOf("Training", "Wellness")),
    InterestChoice("photography", "Photography", listOf("Cameras", "Landscapes")),
    InterestChoice("architecture", "Architecture", listOf("Buildings", "Cities")),
)

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val app = LocalContext.current.applicationContext as EngageApplication
    var step by remember { mutableStateOf(1) }
    var name by remember { mutableStateOf("") }
    var gender by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var length by remember { mutableStateOf<String?>(null) }
    var style by remember { mutableStateOf<String?>(null) }
    var energy by remember { mutableStateOf<String?>(null) }
    var discovery by remember { mutableStateOf<String?>(null) }
    var cadence by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Set up EngageVideo", style = MaterialTheme.typography.headlineMedium)
        Text("Step $step of 3. You can skip anything and change it later.", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (step) {
                1 -> {
                    Text("What should we call you?")
                    OutlinedTextField(name, { name = it.take(40) }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Display name, optional") })
                    Text("How do you identify? This is optional and does not change recommendations.")
                    listOf("male" to "Male", "female" to "Female", "unspecified" to "Prefer not to say").forEach { (value, label) ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = gender == value, onCheckedChange = { gender = if (it) value else null })
                            Text(label)
                        }
                    }
                }
                2 -> {
                    Text("Choose any interests. Every category is available. Examples under a name are suggestions, not extra choices.")
                    interestChoices.forEach { choice ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = choice.id in selected, onCheckedChange = { checked ->
                                selected = if (checked) selected + choice.id else selected - choice.id
                            })
                            Column {
                                Text(choice.label)
                                Text(choice.suggestions.joinToString(" · "), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                else -> {
                    Text("Viewing preferences are optional. Skip leaves them unset.")
                    ChoiceRow("Video length", listOf("short" to "Short", "long" to "Longer"), length) { length = it }
                    ChoiceRow("Style", listOf("educational" to "Educational", "entertainment" to "Entertainment"), style) { style = it }
                    ChoiceRow("Energy", listOf("relaxing" to "Relaxing", "exciting" to "Exciting"), energy) { energy = it }
                    ChoiceRow("Discovery", listOf("trending" to "Trending", "niche" to "Niche"), discovery) { discovery = it }
                    ChoiceRow("Recommendations", listOf("instant" to "Instant", "daily" to "Daily", "weekly" to "Weekly"), cadence) { cadence = it }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (step > 1) TextButton(onClick = { if (!busy) step -= 1 }, enabled = !busy) { Text("Back") }
            TextButton(onClick = {
                if (busy) return@TextButton
                if (step < 3) {
                    step += 1
                } else {
                    finish(scope, app, name, gender, selected, length, style, energy, discovery, cadence, onDone, onBusy = { busy = it }, onError = { error = it })
                }
            }, enabled = !busy) { Text("Skip") }
            Button(onClick = {
                if (busy) return@Button
                if (step < 3) {
                    step += 1
                } else {
                    finish(scope, app, name, gender, selected, length, style, energy, discovery, cadence, onDone, onBusy = { busy = it }, onError = { error = it })
                }
            }, enabled = !busy) { Text(if (step < 3) "Continue" else "Finish") }
        }
    }
}

@Composable
private fun ChoiceRow(title: String, options: List<Pair<String, String>>, selected: String?, onSelect: (String?) -> Unit) {
    Text(title, modifier = Modifier.padding(top = 8.dp))
    options.forEach { (value, label) ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = selected == value, onCheckedChange = { onSelect(if (it) value else null) })
            Text(label)
        }
    }
}

private fun finish(
    scope: kotlinx.coroutines.CoroutineScope,
    app: EngageApplication,
    name: String,
    gender: String?,
    categories: Set<String>,
    length: String?,
    style: String?,
    energy: String?,
    discovery: String?,
    cadence: String?,
    onDone: () -> Unit,
    onBusy: (Boolean) -> Unit,
    onError: (String?) -> Unit,
) {
    onBusy(true)
    onError(null)
    scope.launch {
        try {
            val payload = JSONObject()
                .put("categories", JSONArray(categories.toList()))
                .put("subcategories", JSONArray())
                .put("completed", true)
            if (name.isNotBlank()) payload.put("displayName", name.trim())
            payload.put("gender", gender ?: JSONObject.NULL)
            payload.put("videoLength", length ?: JSONObject.NULL)
            payload.put("contentStyle", style ?: JSONObject.NULL)
            payload.put("energy", energy ?: JSONObject.NULL)
            payload.put("discovery", discovery ?: JSONObject.NULL)
            payload.put("recommendationCadence", cadence ?: JSONObject.NULL)
            withContext(Dispatchers.IO) { app.backend.saveOnboarding(payload) }
            onBusy(false)
            onDone()
        } catch (reason: Exception) {
            onBusy(false)
            onError(reason.message ?: "The profile could not be saved.")
        }
    }
}

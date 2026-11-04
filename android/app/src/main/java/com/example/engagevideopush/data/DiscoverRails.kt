package com.example.engagevideopush.data

object DiscoverRails {
    data class Rail(val title: String, val query: String, val description: String)

    val playlists = listOf(
        Rail("Nature Escape", "nature", "Forests, water, and open sky from Pixabay."),
        Rail("Travel Around The World", "travel", "Cities, roads, and places to go."),
        Rail("Food Lovers", "food", "Cooking, markets, and meals."),
        Rail("Tech & Innovation", "technology", "Labs, devices, and how things are made."),
        Rail("Animal Kingdom", "animals", "Wildlife and pets in motion."),
        Rail("Sports Arena", "sports", "Games, training, and movement."),
        Rail("Daily Inspiration", "entertainment", "Short performances and everyday moments."),
    )

    val searchKeywords = listOf(
        "nature",
        "travel",
        "ocean",
        "city",
        "food",
        "technology",
        "animals",
        "sports",
        "sunset",
    )

    fun rail(query: String): Rail? = playlists.firstOrNull { it.query == query }
}

package com.example.engagevideopush.data

import java.net.URLEncoder

object FeedCategories {
    data class Item(val label: String, val query: String?)

    val all = listOf(
        Item("Popular", null),
        Item("Travel", "travel"),
        Item("Nature", "nature"),
        Item("Food", "food"),
        Item("Technology", "technology"),
        Item("Sports", "sports"),
        Item("Motorsport & Cars", "motorsport"),
        Item("Animals", "animals"),
        Item("Entertainment", "entertainment"),
        Item("Music", "music"),
        Item("Fashion & Beauty", "fashion"),
        Item("Design & Art", "design"),
        Item("Gaming", "gaming"),
        Item("Science & Education", "science"),
        Item("Lifestyle", "lifestyle"),
        Item("Fitness", "fitness"),
        Item("Photography", "photography"),
        Item("Architecture", "architecture"),
    )

    fun path(item: Item, page: Int): String {
        val safePage = page.coerceIn(1, 50)
        val query = item.query
        return if (query.isNullOrBlank()) {
            "/api/videos/popular?page=$safePage"
        } else {
            val encoded = URLEncoder.encode(query, Charsets.UTF_8.name())
            "/api/videos?query=$encoded&page=$safePage"
        }
    }
}

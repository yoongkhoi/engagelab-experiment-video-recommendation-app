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

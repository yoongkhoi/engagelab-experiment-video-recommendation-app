package com.example.engagevideopush.push

object NotificationOpenDeduper {
    private const val WINDOW_MS = 5_000L
    private val seen = object : LinkedHashMap<String, Long>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?) = size > 64
    }

    fun shouldHandle(key: String, now: Long = System.currentTimeMillis()): Boolean {
        synchronized(seen) {
            val previous = seen[key]
            if (previous != null && now - previous < WINDOW_MS) return false
            seen[key] = now
            return true
        }
    }

    fun reset() {
        synchronized(seen) { seen.clear() }
    }
}

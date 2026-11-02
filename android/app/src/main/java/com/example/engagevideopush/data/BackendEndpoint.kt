package com.example.engagevideopush.data

data class EndpointInput(
    val emulator: Boolean,
    val lanHost: String,
    val port: String,
    val savedUrl: String,
)

data class EndpointChoice(
    val url: String,
    val problem: String?,
)

fun resolveBackendEndpoint(input: EndpointInput): EndpointChoice {
    val port = input.port.trim().let { value ->
        if (value.isNotEmpty() && value.all { it.isDigit() }) value else "3000"
    }
    if (input.emulator) return EndpointChoice("http://10.0.2.2:$port", null)
    val saved = input.savedUrl.trim().trimEnd('/')
    if ((saved.startsWith("http://") || saved.startsWith("https://")) && !isLoopbackUrl(saved)) {
        return EndpointChoice(saved, null)
    }
    val host = input.lanHost.trim()
    if (host.isEmpty() || host == "10.0.2.2" || host.equals("localhost", ignoreCase = true) || host == "127.0.0.1") {
        return EndpointChoice(
            "",
            "This phone or tablet cannot use 10.0.2.2. Set Backend URL to this computer's LAN address, for example http://192.168.1.20:$port.",
        )
    }
    return EndpointChoice("http://$host:$port", null)
}

fun isLoopbackUrl(url: String): Boolean {
    return url.contains("://10.0.2.2") || url.contains("://localhost") || url.contains("://127.0.0.1")
}

fun looksLikeEmulator(fingerprint: String, model: String, hardware: String, product: String): Boolean {
    return fingerprint.startsWith("generic")
        || fingerprint.contains("emulator", ignoreCase = true)
        || model.contains("Emulator", ignoreCase = true)
        || model.contains("Android SDK built for", ignoreCase = true)
        || hardware.contains("goldfish")
        || hardware.contains("ranchu")
        || product.contains("sdk_gphone")
}

fun classifyDevice(emulator: Boolean, smallestScreenWidthDp: Int): String {
    if (emulator) return "emulator"
    return if (smallestScreenWidthDp >= 600) "tablet" else "phone"
}

fun connectionFailureMessage(baseUrl: String, timedOut: Boolean, unresolved: Boolean): String {
    val reason = when {
        timedOut -> "The connection timed out."
        unresolved -> "The host could not be resolved."
        else -> "The connection was refused or the network is unreachable."
    }
    val target = baseUrl.ifBlank { "(no backend URL)" }
    return "$reason Backend $target did not answer. An emulator uses http://10.0.2.2 and the backend port. A phone or tablet uses this computer's LAN address. The backend must be running and listening on 0.0.0.0."
}

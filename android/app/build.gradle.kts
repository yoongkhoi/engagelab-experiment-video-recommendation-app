import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val engageProps = Properties().apply {
    val file = rootProject.file("engagelab.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val demoShare = project.hasProperty("demoShare")
val engageAppKey = if (demoShare) "" else engageProps.getProperty("ENGAGELAB_APPKEY", "")
val engageSite = engageProps.getProperty("ENGAGELAB_APP_SITE", "")
val backendPort = engageProps.getProperty("BACKEND_PORT", "").trim().ifBlank {
    val legacy = engageProps.getProperty("BACKEND_BASE_URL", "")
    legacy.substringAfterLast(':').substringBefore('/').ifBlank { "3000" }
}.let { if (it.all { char -> char.isDigit() }) it else "3000" }
val backendLanHost = if (demoShare) {
    ""
} else {
    engageProps.getProperty("BACKEND_LAN_HOST", "").trim().ifBlank { detectLanIpv4() }
}

android {
    namespace = "com.example.engagevideopush"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.example.engagevideopush"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        manifestPlaceholders["ENGAGELAB_PRIVATES_APPKEY"] = engageAppKey.ifBlank { "MISSING_APPKEY" }
        manifestPlaceholders["ENGAGELAB_PRIVATES_CHANNEL"] = "developer"
        manifestPlaceholders["ENGAGELAB_PRIVATES_PROCESS"] = ":remote"
        buildConfigField("String", "ENGAGELAB_APPKEY", "\"$engageAppKey\"")
        buildConfigField("String", "ENGAGELAB_APP_SITE", "\"$engageSite\"")
        buildConfigField("String", "BACKEND_LAN_HOST", quoteBuildConfig(backendLanHost))
        buildConfigField("String", "BACKEND_PORT", quoteBuildConfig(backendPort))
        buildConfigField("String", "BACKEND_BASE_URL", quoteBuildConfig(if (backendLanHost.isBlank()) "" else "http://$backendLanHost:$backendPort"))
        buildConfigField("String", "APP_VERSION_NAME", "\"1.0.0\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.security:security-crypto:1.0.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.engagelab:engagelab:5.4.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

private fun quoteBuildConfig(value: String): String {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

private fun detectLanIpv4(): String {
    val skip = listOf("virtual", "vmware", "hyper-v", "wsl", "bluetooth", "loopback", "vethernet")
    val candidates = mutableListOf<Pair<Int, String>>()
    val interfaces = NetworkInterface.getNetworkInterfaces() ?: return ""
    for (nic in interfaces) {
        if (!nic.isUp || nic.isLoopback) continue
        val name = (nic.displayName + " " + nic.name).lowercase()
        if (skip.any { name.contains(it) }) continue
        for (address in nic.inetAddresses) {
            if (address !is Inet4Address || address.isLoopbackAddress) continue
            val host = address.hostAddress ?: continue
            if (host.startsWith("169.254.")) continue
            val rank = when {
                host.startsWith("192.168.") -> 0
                host.startsWith("10.") -> 1
                host.startsWith("172.") -> 2
                else -> 3
            }
            candidates.add(rank to host)
        }
    }
    return candidates.minByOrNull { it.first }?.second ?: ""
}

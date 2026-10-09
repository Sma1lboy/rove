plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("app.cash.paparazzi")
}
android {
    namespace = "run.rove.mobile"
    compileSdk = 35
    defaultConfig {
        applicationId = "run.rove.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/demo"))
    sourceSets["test"].resources.srcDir("../../rove-ios/Sources/RoveMobile/Demo")
    testOptions.unitTests.isIncludeAndroidResources = true
}
val copyDemo by tasks.registering(Copy::class) {
    from("../../rove-ios/Sources/RoveMobile/Demo/demo-fixture.json")
    into(layout.buildDirectory.dir("generated/demo"))
}
tasks.named("preBuild") { dependsOn(copyDemo) }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
val copyTerminal by tasks.registering(Copy::class) {
    from("../web/node_modules/@xterm/xterm/lib/xterm.js")
    from("../web/node_modules/@xterm/xterm/css/xterm.css")
    from("../web/node_modules/@xterm/addon-fit/lib/addon-fit.js")
    into(layout.buildDirectory.dir("generated/terminal/terminal"))
    doFirst {
        check(file("../web/node_modules/@xterm/xterm/lib/xterm.js").exists()) { "Run npm ci --prefix web first" }
    }
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/terminal"))
tasks.named("preBuild") { dependsOn(copyTerminal) }

val copyTerminalLicenses by tasks.registering(Copy::class) {
    from("../web/node_modules/@xterm/xterm/LICENSE") { rename { "xterm.txt" } }
    from("../web/node_modules/@xterm/addon-fit/LICENSE") { rename { "addon-fit.txt" } }
    into(layout.buildDirectory.dir("generated/terminal/terminal/licenses"))
}
tasks.named("preBuild") { dependsOn(copyTerminalLicenses) }

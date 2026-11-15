plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.nyxdesk"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.nyxdesk"
        minSdk = 26
        targetSdk = 34
        versionCode = 3
        versionName = "2.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // The whole web app lives in /web and is bundled into the APK as assets,
    // so Nyxdesk runs fully offline and never fetches anything from the internet.
    sourceSets {
        getByName("main") {
            assets.srcDirs("../web")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    // On-device text recognition for "Make searchable" (models are bundled in the APK; no network use)
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-devanagari:16.0.1")
}

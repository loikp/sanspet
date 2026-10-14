plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* ================= 签名配置 =================

   有 keystore.properties（以及它指向的 .jks）时 → 用正式签名
   没有                                        → 退回 Android 默认的 debug 签名

   这样即使密钥还没配好，打包也不会挂，只是签名是临时的。

   keystore.properties 放在【项目根目录】，不要提交到 git（.gitignore 已加）。
   内容四行，密码两边写一样的（PKCS12 要求一致）：

       storeFile=sanspet-release.jks
       storePassword=你的口令
       keyAlias=sanspet
       keyPassword=你的口令

   ⚠️ 口令只用字母和数字，别用 = : 和反斜杠，properties 文件会被它们搞乱。
   ============================================== */
val ksPropsFile = rootProject.file("keystore.properties")
val ksProps = java.util.Properties().apply {
    if (ksPropsFile.exists()) ksPropsFile.inputStream().use { load(it) }
}
val hasReleaseKey = ksPropsFile.exists() && !ksProps.getProperty("storeFile").isNullOrBlank()

android {
    namespace = "com.sanspet.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sanspet.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 100
        versionName = "1.0.0"
    }

    signingConfigs {
        getByName("debug")
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(ksProps.getProperty("storeFile") ?: "sanspet-release.jks")
                storePassword = ksProps.getProperty("storePassword")
                keyAlias = ksProps.getProperty("keyAlias")
                keyPassword = ksProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release")
                            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}

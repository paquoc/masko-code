plugins {
    id("org.jetbrains.intellij") version "1.17.4"
    kotlin("jvm") version "1.9.25"
}

group = "ai.masko"
version = "1.0.0"

repositories {
    mavenCentral()
}

// Kotlin stdlib is already provided by the IntelliJ runtime
kotlin {
    jvmToolchain(17)
}

dependencies {
    // Prevent kotlin-stdlib from being bundled (JetBrains IDEs ship it)
    compileOnly(kotlin("stdlib"))
}

intellij {
    version.set("2023.3")
    type.set("IC")
    plugins.set(emptyList())
}

tasks {
    patchPluginXml {
        sinceBuild.set("233")
        // No upper bound - compatible with all future versions
        untilBuild.set("")
    }

    // Not needed for a headless utility plugin
    buildSearchableOptions {
        enabled = false
    }

    jar {
        archiveBaseName.set("masko-terminal-focus")
    }
}

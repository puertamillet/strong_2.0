// swift-tools-version: 5.9
import PackageDescription

// The app's own Capacitor plugin (ios/Sources/StrongNativePlugin). The app's package.json depends
// on this folder, so `npx cap sync ios` adds it to the iPhone app like the plugins in node_modules.
let package = Package(
    name: "StrongNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "StrongNative",
            targets: ["StrongNativePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "StrongNativePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/StrongNativePlugin")
    ]
)

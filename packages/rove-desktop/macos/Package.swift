// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RoveMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "RoveMac", targets: ["RoveMac"])],
    dependencies: [.package(url: "https://github.com/Lakr233/libghostty-spm.git", exact: "2.2.2026111701")],
    targets: [
        .executableTarget(name: "RoveMac", dependencies: [.product(name: "GhosttyTerminal", package: "libghostty-spm")]),
        .testTarget(name: "RoveMacTests", dependencies: ["RoveMac"]),
    ]
)

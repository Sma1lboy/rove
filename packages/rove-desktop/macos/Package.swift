// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RoveMac",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "RoveMac", targets: ["RoveMac"])],
    dependencies: [.package(url: "https://github.com/migueldeicaza/SwiftTerm", exact: "1.18.0")],
    targets: [
        .executableTarget(name: "RoveMac", dependencies: ["SwiftTerm"]),
        .testTarget(name: "RoveMacTests", dependencies: ["RoveMac"]),
    ]
)

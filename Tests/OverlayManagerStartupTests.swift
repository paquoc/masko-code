import XCTest
@testable import masko_code

final class OverlayManagerStartupTests: XCTestCase {
    @MainActor
    func testStartupMascotPrefersClippyWhenAvailable() {
        let other = SavedMascot(
            id: UUID(),
            name: "Other",
            config: makeConfig(name: "Other"),
            addedAt: Date(),
            templateSlug: "other"
        )
        let clippy = SavedMascot(
            id: UUID(),
            name: "Clippy",
            config: makeConfig(name: "Clippy"),
            addedAt: Date(),
            templateSlug: "clippy"
        )

        let chosen = OverlayManager.startupMascotConfig(from: [other, clippy])

        XCTAssertEqual(chosen?.name, "Clippy")
    }

    @MainActor
    func testStartupMascotFallsBackToFirstWhenNoClippy() {
        let first = SavedMascot(
            id: UUID(),
            name: "First",
            config: makeConfig(name: "First"),
            addedAt: Date(),
            templateSlug: "first"
        )
        let second = SavedMascot(
            id: UUID(),
            name: "Second",
            config: makeConfig(name: "Second"),
            addedAt: Date(),
            templateSlug: "second"
        )

        let chosen = OverlayManager.startupMascotConfig(from: [first, second])

        XCTAssertEqual(chosen?.name, "First")
    }

    private func makeConfig(name: String) -> MaskoAnimationConfig {
        MaskoAnimationConfig(
            version: "1.0",
            name: name,
            initialNode: "idle",
            autoPlay: true,
            nodes: [
                MaskoAnimationNode(id: "idle", name: "Idle", transparentThumbnailUrl: nil),
            ],
            edges: [
                MaskoAnimationEdge(
                    id: "idle-loop",
                    source: "idle",
                    target: "idle",
                    isLoop: true,
                    duration: 1.0,
                    conditions: nil,
                    videos: MaskoAnimationVideos(webm: nil, hevc: nil)
                ),
            ],
            inputs: nil
        )
    }
}

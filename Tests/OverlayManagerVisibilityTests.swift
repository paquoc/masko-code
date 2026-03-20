import AppKit
import XCTest
@testable import masko_code

final class OverlayManagerVisibilityTests: XCTestCase {
    @MainActor
    func testStartingMascotRectClampsSavedOffscreenOrigin() {
        let screen = NSRect(x: 0, y: 0, width: 1000, height: 700)

        let rect = OverlayManager.startingMascotRect(
            savedX: 5000,
            savedY: 5000,
            sidePixels: 150,
            screenFrame: screen
        )

        XCTAssertEqual(rect.width, 150, accuracy: 0.001)
        XCTAssertEqual(rect.height, 150, accuracy: 0.001)
        XCTAssertEqual(rect.origin.x, 850, accuracy: 0.001)
        XCTAssertEqual(rect.origin.y, 550, accuracy: 0.001)
    }

    @MainActor
    func testStartingMascotRectUsesMinimumSizeWhenInputIsZero() {
        let screen = NSRect(x: 0, y: 0, width: 1000, height: 700)

        let rect = OverlayManager.startingMascotRect(
            savedX: 0,
            savedY: 0,
            sidePixels: 0,
            screenFrame: screen
        )

        XCTAssertEqual(rect.width, 50, accuracy: 0.001)
        XCTAssertEqual(rect.height, 50, accuracy: 0.001)
        XCTAssertEqual(rect.origin.x, 910, accuracy: 0.001)
        XCTAssertEqual(rect.origin.y, 40, accuracy: 0.001)
    }

    @MainActor
    func testClampedMascotRectCapsSizeToScreenBounds() {
        let screen = NSRect(x: 100, y: 200, width: 120, height: 120)

        let rect = OverlayManager.clampedMascotRect(
            origin: CGPoint(x: 140, y: 230),
            side: 400,
            screenFrame: screen
        )

        XCTAssertEqual(rect.width, 120, accuracy: 0.001)
        XCTAssertEqual(rect.height, 120, accuracy: 0.001)
        XCTAssertEqual(rect.origin.x, 100, accuracy: 0.001)
        XCTAssertEqual(rect.origin.y, 200, accuracy: 0.001)
    }
}

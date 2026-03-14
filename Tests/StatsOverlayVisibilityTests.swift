import XCTest
@testable import masko_code

final class StatsOverlayVisibilityTests: XCTestCase {
    func testHiddenWhenAllMetricsAreZero() {
        XCTAssertFalse(
            StatsOverlayVisibility.shouldShow(
                activeSessions: 0,
                activeSubagents: 0,
                compactCount: 0,
                pendingPermissions: 0,
                runningSessions: 0
            )
        )
    }

    func testVisibleWhenAnyMetricIsNonZero() {
        XCTAssertTrue(
            StatsOverlayVisibility.shouldShow(
                activeSessions: 1,
                activeSubagents: 0,
                compactCount: 0,
                pendingPermissions: 0,
                runningSessions: 0
            )
        )
        XCTAssertTrue(
            StatsOverlayVisibility.shouldShow(
                activeSessions: 0,
                activeSubagents: 1,
                compactCount: 0,
                pendingPermissions: 0,
                runningSessions: 0
            )
        )
        XCTAssertTrue(
            StatsOverlayVisibility.shouldShow(
                activeSessions: 0,
                activeSubagents: 0,
                compactCount: 1,
                pendingPermissions: 0,
                runningSessions: 0
            )
        )
        XCTAssertTrue(
            StatsOverlayVisibility.shouldShow(
                activeSessions: 0,
                activeSubagents: 0,
                compactCount: 0,
                pendingPermissions: 1,
                runningSessions: 0
            )
        )
        XCTAssertTrue(
            StatsOverlayVisibility.shouldShow(
                activeSessions: 0,
                activeSubagents: 0,
                compactCount: 0,
                pendingPermissions: 0,
                runningSessions: 1
            )
        )
    }
}

import XCTest
@testable import masko_code

final class ConstantsServerPortTests: XCTestCase {
    private let defaults = UserDefaults.standard
    private let serverPortKey = "serverPort"

    override func tearDown() {
        super.tearDown()
        defaults.removeObject(forKey: serverPortKey)
    }

    func testServerPortUsesSafeDefaultWhenUnset() {
        defaults.removeObject(forKey: serverPortKey)

        XCTAssertEqual(Constants.serverPort, Constants.defaultServerPort)
    }

    func testServerPortMigratesLegacyDefault() {
        defaults.set(Int(Constants.legacyDefaultServerPort), forKey: serverPortKey)

        XCTAssertEqual(Constants.serverPort, Constants.defaultServerPort)
        XCTAssertEqual(defaults.integer(forKey: serverPortKey), Int(Constants.defaultServerPort))
    }

    func testServerPortPreservesCustomStoredValue() {
        defaults.set(47001, forKey: serverPortKey)

        XCTAssertEqual(Constants.serverPort, 47001)
    }
}

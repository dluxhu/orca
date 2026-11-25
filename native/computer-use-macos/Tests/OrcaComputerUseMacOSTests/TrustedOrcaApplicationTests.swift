@testable import OrcaComputerUseMacOSCore
import XCTest

final class TrustedOrcaApplicationTests: XCTestCase {
    func testOfficialOrcaIdsAreTrusted() {
        XCTAssertTrue(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orca"))
        XCTAssertTrue(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orca.dev.wt"))
    }

    func testForkIdsAreTrusted() {
        XCTAssertTrue(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orca.dlux"))
        XCTAssertTrue(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orca.dlux.nightly"))
        XCTAssertTrue(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orca.dlux.profile.work"))
    }

    func testLookalikeIdsAreNotTrusted() {
        XCTAssertFalse(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orca.dluxevil"))
        XCTAssertFalse(TrustedOrcaApplication.isTrusted(bundleId: "com.stablyai.orcax"))
        XCTAssertFalse(TrustedOrcaApplication.isTrusted(bundleId: "com.example.app"))
    }
}

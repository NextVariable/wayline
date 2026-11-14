import CoreLocation
import Foundation

/// 后台定位采集器。使用 Core Location 的后台定位和显著位置变化，
/// 应用被系统终止后由系统重新拉起，不依赖 WebView。
final class FootprintManager: NSObject, CLLocationManagerDelegate {
    static let shared = FootprintManager()

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private var policy: TrackingPolicy?
    private var still = false

    var onAuthorizationChange: (() -> Void)?

    var installationId: String {
        if let id = defaults.string(forKey: "fp.installationId") { return id }
        let id = UUID().uuidString
        defaults.set(id, forKey: "fp.installationId")
        return id
    }

    var enabled: Bool { defaults.bool(forKey: "fp.enabled") }
    var paused: Bool { defaults.bool(forKey: "fp.paused") }
    var owner: String { defaults.string(forKey: "fp.owner") ?? "" }
    var running: Bool { defaults.bool(forKey: "fp.running") }
    var lastFixAt: Double { defaults.double(forKey: "fp.lastFixAt") }
    /// 只有"已启用且未暂停"才允许采集，系统拉起应用时也以此为准。
    var shouldRecord: Bool { enabled && !paused && !owner.isEmpty }

    override private init() {
        super.init()
        manager.delegate = self
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
    }

    var authorization: CLAuthorizationStatus { manager.authorizationStatus }
    var alwaysGranted: Bool { authorization == .authorizedAlways }
    var foregroundGranted: Bool { authorization == .authorizedAlways || authorization == .authorizedWhenInUse }

    /// 应用启动（包括被系统因位置事件拉起）时调用，按用户意图恢复。
    func restoreIfNeeded() {
        guard shouldRecord else { return }
        guard alwaysGranted else {
            interrupt("定位权限不是“始终”")
            return
        }
        // 进程曾被终止：留下缺口，下一点开新段。
        beginCollecting(markGap: running)
    }

    /// 由用户在足迹页明确点击启用时调用。
    func requestEnable(owner: String) {
        if self.owner != owner {
            stopCollecting()
            defaults.set(0, forKey: "fp.lastFixAt")
        }
        defaults.set(owner, forKey: "fp.owner")
        defaults.set(true, forKey: "fp.enabled")
        defaults.set(false, forKey: "fp.paused")
        switch authorization {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        case .authorizedAlways: beginCollecting(markGap: false)
        default: break
        }
    }

    func pause() {
        defaults.set(true, forKey: "fp.paused")
        if enabled {
            FootprintDatabase.shared.insert(owner: owner, time: now(), kind: "gap:用户暂停", lat: nil, lng: nil, acc: nil, seg: 0)
        }
        stopCollecting()
    }

    func resume() -> Bool {
        guard enabled, alwaysGranted else { return false }
        defaults.set(false, forKey: "fp.paused")
        beginCollecting(markGap: true)
        return true
    }

    func disable() {
        defaults.set(false, forKey: "fp.enabled")
        defaults.set(false, forKey: "fp.paused")
        stopCollecting()
    }

    private func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func beginCollecting(markGap: Bool) {
        guard shouldRecord, CLLocationManager.locationServicesEnabled() else {
            interrupt("系统定位已关闭")
            return
        }
        if policy == nil {
            policy = TrackingPolicy(firstSegment: FootprintDatabase.shared.maxSegment(owner: owner) + 1)
        }
        if markGap {
            policy?.markBreak()
            FootprintDatabase.shared.insert(owner: owner, time: now(), kind: "gap:应用被系统重新启动", lat: nil, lng: nil, acc: nil, seg: 0)
        }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        manager.startUpdatingLocation()
        // 被系统终止后，显著位置变化可重新拉起应用。
        manager.startMonitoringSignificantLocationChanges()
        defaults.set(true, forKey: "fp.running")
    }

    private func stopCollecting() {
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
        policy = nil
        still = false
        defaults.set(false, forKey: "fp.running")
    }

    private func interrupt(_ reason: String) {
        if enabled {
            FootprintDatabase.shared.insert(owner: owner, time: now(), kind: "gap:" + reason, lat: nil, lng: nil, acc: nil, seg: 0)
        }
        manager.stopUpdatingLocation()
        policy?.markBreak()
        defaults.set(false, forKey: "fp.running")
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if shouldRecord {
            switch manager.authorizationStatus {
            case .authorizedWhenInUse:
                // 用户在启用流程里先授予"使用期间"，再申请"始终"。
                manager.requestAlwaysAuthorization()
            case .authorizedAlways:
                if !running { beginCollecting(markGap: false) }
            case .denied, .restricted:
                interrupt("定位权限已被收回")
            default: break
            }
        } else if enabled, manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            interrupt("定位权限已被收回")
        }
        onAuthorizationChange?()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard shouldRecord else { return }
        if policy == nil {
            policy = TrackingPolicy(firstSegment: FootprintDatabase.shared.maxSegment(owner: owner) + 1)
        }
        for location in locations {
            let time = location.timestamp.timeIntervalSince1970 * 1000
            let fix = TrackingPolicy.Fix(time: time, lat: location.coordinate.latitude,
                                         lng: location.coordinate.longitude, accuracy: location.horizontalAccuracy)
            guard var p = policy else { return }
            let result = p.onFix(fix, now: Date().timeIntervalSince1970 * 1000)
            policy = p
            if result.verdict == .accept {
                let ok = FootprintDatabase.shared.insert(owner: owner, time: Int64(time), kind: "fix",
                                                         lat: fix.lat, lng: fix.lng, acc: fix.accuracy, seg: result.segment)
                if ok { defaults.set(time, forKey: "fp.lastFixAt") } else { interrupt("本机保存失败") }
            }
            // 静止时放宽过滤，减少耗电；明显移动后恢复。
            if result.enterStill && !still {
                still = true
                manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
                manager.distanceFilter = 50
            } else if !result.enterStill && still && result.verdict == .accept {
                still = false
                manager.desiredAccuracy = kCLLocationAccuracyBest
                manager.distanceFilter = 10
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let e = error as? CLError, e.code == .denied { interrupt("定位权限已被收回") }
        // 其他暂时性错误（如 locationUnknown）系统会自行重试，不记为缺口。
    }
}

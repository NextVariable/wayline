import Foundation

/// 采样过滤与静止判断。只依赖 Foundation，规则与网页端 acceptPoint 和 Android 端保持一致：
/// 不补点、不连线，出现缺口就开新段。
struct TrackingPolicy {
    static let maxAccuracy: Double = 100
    static let breakSeconds: Double = 120
    static let stillAfterSeconds: Double = 5 * 60
    static let stillRadius: Double = 30

    struct Fix {
        var time: Double // 毫秒时间戳
        var lat: Double
        var lng: Double
        var accuracy: Double
    }

    enum Verdict { case accept, skip, reject }

    struct Result {
        var verdict: Verdict
        var segment: Int
        var enterStill: Bool
    }

    private var last: Fix?
    private var anchor: Fix?
    private var segment: Int
    private var breakPending = false

    init(firstSegment: Int) { segment = firstSegment }

    /// 暂停、恢复、权限变化、系统回收等任何连续性中断后调用，下一个有效点会开新段。
    mutating func markBreak() {
        breakPending = true
        anchor = nil
    }

    mutating func onFix(_ fix: Fix, now: Double) -> Result {
        guard fix.lat.isFinite, fix.lng.isFinite, abs(fix.lat) <= 90, abs(fix.lng) <= 180,
              fix.accuracy >= 0, fix.accuracy <= Self.maxAccuracy,
              fix.time > 0, fix.time <= now + 10_000 else {
            return Result(verdict: .reject, segment: segment, enterStill: false)
        }
        var next = segment
        if let last {
            if fix.time <= last.time { return Result(verdict: .reject, segment: segment, enterStill: false) }
            let dt = (fix.time - last.time) / 1000
            let dist = Self.distance(last.lat, last.lng, fix.lat, fix.lng)
            if !breakPending, dt < Self.breakSeconds,
               dist > max(300, dt * 120 + fix.accuracy + last.accuracy) {
                return Result(verdict: .reject, segment: segment, enterStill: false)
            }
            if dt >= Self.breakSeconds { next += 1 }
        }
        if breakPending { next = max(next, segment + 1) }

        var enterStill = false
        if let a = anchor, Self.distance(a.lat, a.lng, fix.lat, fix.lng) <= max(Self.stillRadius, fix.accuracy) {
            if (fix.time - a.time) / 1000 >= Self.stillAfterSeconds { enterStill = true }
        } else {
            anchor = fix
        }

        if let last, next == segment,
           Self.distance(last.lat, last.lng, fix.lat, fix.lng) < max(5, min(fix.accuracy, last.accuracy) / 2) {
            return Result(verdict: .skip, segment: segment, enterStill: enterStill)
        }
        segment = next
        breakPending = false
        last = fix
        return Result(verdict: .accept, segment: segment, enterStill: enterStill)
    }

    static func distance(_ lat1: Double, _ lng1: Double, _ lat2: Double, _ lng2: Double) -> Double {
        let rad = Double.pi / 180
        let dLat = sin((lat2 - lat1) * rad / 2)
        let dLng = sin((lng2 - lng1) * rad / 2)
        let a = dLat * dLat + cos(lat1 * rad) * cos(lat2 * rad) * dLng * dLng
        return 6_371_008.8 * 2 * asin(min(1, sqrt(a)))
    }
}

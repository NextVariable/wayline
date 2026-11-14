import Capacitor
import CoreLocation
import UIKit

@objc(NativeFootprintsPlugin)
public class NativeFootprintsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeFootprintsPlugin"
    public let jsName = "NativeFootprints"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
    ]

    private var manager: FootprintManager { FootprintManager.shared }

    private func snapshot(owner: String? = nil) -> JSObject {
        let requested = owner ?? manager.owner
        let own = requested == manager.owner
        return [
            "owner": requested,
            "installationId": manager.installationId,
            "occupied": manager.enabled && !own,
            "platform": "ios",
            "enabled": own && manager.enabled,
            "paused": own && manager.paused,
            "running": own && manager.running,
            "still": false,
            "lastFixAt": own ? manager.lastFixAt : 0,
            "foregroundPermission": manager.foregroundGranted,
            "alwaysPermission": manager.alwaysGranted,
        ]
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let owner = call.getString("owner"), !owner.isEmpty else { call.reject("缺少空间标识"); return }
        call.resolve(snapshot(owner: owner))
    }

    private func owns(_ call: CAPPluginCall) -> Bool {
        guard let owner = call.getString("owner"), !owner.isEmpty, owner == manager.owner else {
            call.reject("空间不匹配", "owner_conflict"); return false
        }
        return true
    }

    @objc func enable(_ call: CAPPluginCall) {
        guard let owner = call.getString("owner"), !owner.isEmpty else {
            call.reject("缺少空间标识")
            return
        }
        // 权限弹窗由系统异步处理，结果通过 status 轮询或权限变化回调反映。
        DispatchQueue.main.async {
            guard !self.manager.enabled || self.manager.owner == owner else {
                call.reject("另一空间正在记录", "owner_conflict"); return
            }
            self.manager.requestEnable(owner: owner)
            call.resolve(self.snapshot())
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.owns(call) else { return }
            self.manager.pause()
            call.resolve(self.snapshot())
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.owns(call) else { return }
            guard self.manager.enabled else { call.reject("尚未启用自动足迹"); return }
            guard self.manager.resume() else { call.reject("定位权限不是“始终”", "denied"); return }
            call.resolve(self.snapshot())
        }
    }

    @objc func disable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.owns(call) else { return }
            self.manager.disable()
            call.resolve(self.snapshot())
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let owner = call.getString("owner"), !owner.isEmpty else { call.reject("缺少空间标识"); return }
        let after = Int64(call.getInt("afterId") ?? 0)
        let limit = min(call.getInt("limit") ?? 2000, 5000)
        let rows = FootprintDatabase.shared.read(owner: owner, afterId: after, limit: limit)
        call.resolve(["entries": rows])
    }
}

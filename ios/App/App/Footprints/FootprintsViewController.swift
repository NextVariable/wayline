import Capacitor

/// 注册原生足迹插件。Capacitor 8 的本地插件需要在桥加载后手动注册。
class FootprintsViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeFootprintsPlugin())
    }
}

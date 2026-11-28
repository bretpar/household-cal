import UIKit
import UserNotifications
import Capacitor

/// In-tree, badge-only plugin. No APNs, remote registration, banners or sounds:
/// it only asks for `.badge` authorization and sets the absolute app icon count.
@objc(AppBadgePlugin)
public class AppBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppBadgePlugin"
    public let jsName = "AppBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCount", returnType: CAPPluginReturnPromise),
    ]

    @objc func checkPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let state: String
            if settings.authorizationStatus == .notDetermined { state = "prompt" }
            else if settings.badgeSetting == .enabled { state = "granted" }
            else { state = "denied" }
            call.resolve(["badge": state])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { granted, _ in
            call.resolve(["badge": granted ? "granted" : "denied"])
        }
    }

    @objc func setCount(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(count) { error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
            }
        } else {
            DispatchQueue.main.async {
                UIApplication.shared.applicationIconBadgeNumber = count
                call.resolve()
            }
        }
    }
}

/// Storyboard bridge controller that registers in-tree plugins alongside the
/// npm-linked ones (Filesystem, Share, etc. are still auto-registered).
class AppBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppBadgePlugin())
    }
}

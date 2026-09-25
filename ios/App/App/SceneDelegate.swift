import UIKit
import Capacitor

/// Minimal UIScene lifecycle support (required by newer iOS SDKs).
/// The window and the single Capacitor bridge/WKWebView still come from
/// Main.storyboard (CAPBridgeViewController) via the scene manifest.
/// URL opens and Universal Links arrive here under the scene lifecycle,
/// so they are forwarded to Capacitor's ApplicationDelegateProxy exactly
/// as AppDelegate did — this keeps @capacitor/app `appUrlOpen` events
/// (including the native Google sign-in return) working unchanged.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        // Cold launch via custom scheme or Universal Link.
        if let urlContext = connectionOptions.urlContexts.first {
            forward(urlContext)
        }
        if let activity = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            forward(context)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    private func forward(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication {
            options[.sourceApplication] = source
        }
        options[.openInPlace] = context.options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }
}

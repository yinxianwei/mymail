import AppKit
import Foundation
import SwiftUI
import Translation

struct Request: Decodable {
    let texts: [String]
    let englishUI: Bool
    let statusOnly: Bool
}
struct Response: Encodable {
    var status: String
    var texts: [String] = []
}

@MainActor
final class Runner: NSObject, NSApplicationDelegate, NSWindowDelegate {
    static let shared = Runner()
    var request: Request!
    var window: NSWindow?
    var completed = false
    func finish(_ response: Response) {
        guard !completed else { return }
        completed = true
        if let bytes = try? JSONEncoder().encode(response) {
            FileHandle.standardOutput.write(bytes)
        }
        NSApp.terminate(nil)
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            let availability = await LanguageAvailability().status(from: Locale.Language(identifier: "en"), to: Locale.Language(identifier: "zh-Hans"))
            if request.statusOnly {
                finish(Response(status: availability == .installed ? "installed" : availability == .supported ? "download-required" : "unsupported"))
                return
            }
            guard availability != .unsupported else { finish(Response(status: "unsupported")); return }
            let view = TranslationView(request: request)
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 180), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            panel.title = request.englishUI ? "Translate to Chinese" : "翻译为中文"
            panel.contentView = NSHostingView(rootView: view)
            panel.delegate = self
            panel.center()
            panel.makeKeyAndOrderFront(nil)
            window = panel
            NSApp.activate(ignoringOtherApps: true)
        }
    }
    func windowWillClose(_ notification: Notification) { finish(Response(status: "cancelled")) }
}

struct TranslationView: View {
    let request: Request
    @State private var configuration: TranslationSession.Configuration? = .init(source: Locale.Language(identifier:"en"), target: Locale.Language(identifier:"zh-Hans"))
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text(request.englishUI ? "Preparing on-device translation…" : "正在准备本机翻译…")
            Text(request.englishUI ? "macOS may ask to download language packs." : "macOS 可能会提示下载所需语言包。")
                .font(.caption).foregroundStyle(.secondary)
            Button(request.englishUI ? "Cancel" : "取消") { Runner.shared.finish(Response(status:"cancelled")) }
        }
        .padding(24).frame(width:420,height:180)
        .translationTask(configuration) { session in
            do {
                try await session.prepareTranslation()
                var texts = Array(repeating: "", count: request.texts.count)
                // Small batches preserve input order while avoiding one request
                // per inline HTML fragment.
                for start in stride(from: 0, to: request.texts.count, by: 50) {
                    try Task.checkCancellation()
                    let end = min(start + 50, request.texts.count)
                    let batch = (start..<end).map { TranslationSession.Request(sourceText: request.texts[$0], clientIdentifier: String($0)) }
                    let responses = try await session.translations(from: batch)
                    guard responses.count == batch.count else { Runner.shared.finish(Response(status:"failed")); return }
                    for response in responses {
                        guard let key = response.clientIdentifier, let index = Int(key), index >= start, index < end, texts[index].isEmpty else { Runner.shared.finish(Response(status:"failed")); return }
                        texts[index] = response.targetText
                    }
                }
                Runner.shared.finish(Response(status:"translated",texts:texts))
            } catch is CancellationError {
                Runner.shared.finish(Response(status:"cancelled"))
            } catch {
                // No source text, translated text, or system error descriptions
                // are written to logs or the helper's output.
                Runner.shared.finish(Response(status:"failed"))
            }
        }
    }
}

@main
struct TranslationHelper {
    @MainActor static func main() {
        guard let request = try? JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile()),
              request.texts.count <= 1000,
              request.texts.reduce(0, {$0+$1.utf8.count}) <= 100_000 else { return }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        Runner.shared.request = request
        app.delegate = Runner.shared
        app.run()
    }
}

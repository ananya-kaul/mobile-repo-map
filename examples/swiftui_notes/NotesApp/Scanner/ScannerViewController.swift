import SwiftUI
import UIKit
import Vision
import VisionKit

/// SwiftUI wrapper so the UIKit scanner flow can be shown in a sheet.
struct ScannerView: UIViewControllerRepresentable {
    var onSave: (String) -> Void

    func makeUIViewController(context: Context) -> UINavigationController {
        UINavigationController(rootViewController: ScannerViewController(onSave: onSave))
    }

    func updateUIViewController(_ uiViewController: UINavigationController, context: Context) {}
}

final class ScannerViewController: UIViewController {
    private let onSave: (String) -> Void
    private let statusLabel = UILabel()
    private let scanButton = UIButton(configuration: .filled())

    init(onSave: @escaping (String) -> Void) {
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Scan document"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .cancel,
            primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
        )

        statusLabel.text = "Scan a page and its text becomes a note."
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        scanButton.configuration?.title = "Start scanning"
        scanButton.addTarget(self, action: #selector(startScan), for: .primaryActionTriggered)

        let stack = UIStackView(arrangedSubviews: [statusLabel, scanButton])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
    }

    @objc private func startScan() {
        guard VNDocumentCameraViewController.isSupported else {
            statusLabel.text = "Document scanning isn't available on this device."
            return
        }
        let camera = VNDocumentCameraViewController()
        camera.delegate = self
        present(camera, animated: true)
    }

    private func openResult(_ text: String) {
        navigationController?.pushViewController(ScanResultViewController(text: text, onSave: onSave), animated: true)
    }

    private func recognizeText(in scan: VNDocumentCameraScan) {
        statusLabel.text = "Reading text…"
        let images = (0..<scan.pageCount).compactMap { scan.imageOfPage(at: $0).cgImage }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var lines: [String] = []
            for image in images {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                try? VNImageRequestHandler(cgImage: image).perform([request])
                lines += (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            }
            DispatchQueue.main.async {
                self?.statusLabel.text = "Scan a page and its text becomes a note."
                self?.openResult(lines.joined(separator: "\n"))
            }
        }
    }
}

extension ScannerViewController: VNDocumentCameraViewControllerDelegate {
    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        controller.dismiss(animated: true)
        recognizeText(in: scan)
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        statusLabel.text = error.localizedDescription
    }
}

import UIKit

final class ScanResultViewController: UIViewController {
    private let text: String
    private let onSave: (String) -> Void
    private let textView = UITextView()

    init(text: String, onSave: @escaping (String) -> Void) {
        self.text = text
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Recognized text"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Save note",
            primaryAction: UIAction { [weak self] _ in self?.save() }
        )

        textView.text = text.isEmpty ? "No text was found on this page." : text
        textView.font = .preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.frame = view.bounds
        textView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(textView)
    }

    private func save() {
        onSave(textView.text)
        navigationController?.dismiss(animated: true)
    }
}

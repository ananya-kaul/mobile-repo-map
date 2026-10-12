import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSwift, analyzeStoryboard } from '../src/lang/swift.js';

// String.raw keeps Swift's `\(...)` interpolation intact.
const swift = (text, path = 'App/Sources/File.swift') => analyzeSwift({ path, text });
const type = (facts, name, kind) => facts.types.find((t) => t.name === name && (!kind || t.kind === kind));
const navTo = (facts, cls) => facts.navigation.filter((n) => n.classes.includes(cls));
const api = (facts, expr) => facts.apis.find((a) => a.expr === expr);

// ---------------------------------------------------------------- SwiftUI

const SWIFTUI = String.raw`
import SwiftUI

@main
struct NotesApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct HomeView: View {
    @State private var showEditor = false
    @State private var item: Item?
    var body: some View {
        NavigationStack {
            List(notes) { note in
                NavigationLink(destination: NoteDetailView(note: note)) {
                    Text(note.title)
                }
                NavigationLink {
                    SettingsView()
                } label: {
                    Label("Settings", systemImage: "gear")
                }
            }
            .navigationDestination(for: Note.self) { NoteDetailScreen(note: $0) }
            .sheet(isPresented: $showEditor) { EditorScreen() }
            .fullScreenCover(item: $item) { item in OnboardingScreen(item: item) }
            .alert("Oops", isPresented: $failed) { Button("OK") {} }
            .navigationTitle("Notes")
        }
    }
}

@MainActor
final class Box<T: Equatable>: Base<T>, Proto where T: Hashable {
}
protocol Repo: AnyObject { func load() }
enum Kind { case a, b }
`;

test('struct HomeView: View inherits View', () => {
  const f = swift(SWIFTUI);
  const home = type(f, 'HomeView');
  assert.equal(home.kind, 'struct');
  assert.deepEqual(home.inherits, ['View']);
  assert.equal(home.line, 13);
  assert.equal(home.bodyStart, undefined); // internal offsets are stripped
});

test('attributes, generic inheritance with where-clauses, protocols and enums', () => {
  const f = swift(SWIFTUI);
  assert.deepEqual(type(f, 'NotesApp').attributes, ['main']);
  assert.deepEqual(type(f, 'NotesApp').inherits, ['App']);
  const box = type(f, 'Box');
  assert.equal(box.kind, 'class');
  assert.deepEqual(box.inherits, ['Base', 'Proto']);
  assert.deepEqual(box.attributes, ['MainActor']);
  assert.equal(type(f, 'Repo').kind, 'protocol');
  assert.deepEqual(type(f, 'Repo').inherits, ['AnyObject']);
  assert.equal(type(f, 'Kind').kind, 'enum');
});

test('@main App with WindowGroup produces a root entry listing only the root view', () => {
  const f = swift(SWIFTUI);
  assert.deepEqual(f.entries, [{ classes: ['RootView'], line: 5, app: 'NotesApp' }]);
  assert.equal(f.hasMain, true);
});

test('@main entry also works for Window(...) scenes', () => {
  const f = swift(String.raw`@main
struct MyApp: App {
  var body: some Scene {
    Window("Main", id: "main") {
      ContentView()
    }
  }
}
`);
  assert.deepEqual(f.entries[0].classes, ['ContentView']);
});

test('@main without a scene body still records the app entry', () => {
  const f = swift('@main\nclass AppDelegate: UIResponder, UIApplicationDelegate {\n  var window: UIWindow?\n}\n');
  assert.deepEqual(f.entries, [{ classes: [], line: 2, app: 'AppDelegate' }]);
});

test('NavigationLink(destination:) pushes the destination view', () => {
  const [n] = navTo(swift(SWIFTUI), 'NoteDetailView');
  assert.equal(n.method, 'NavigationLink');
  assert.equal(n.kind, 'push');
  assert.equal(n.fromType, 'HomeView');
  assert.ok(!n.classes.includes('Text'));
});

test('NavigationLink { } label: { } pushes the closure view, not the label', () => {
  const [n] = navTo(swift(SWIFTUI), 'SettingsView');
  assert.equal(n.kind, 'push');
  assert.deepEqual(n.classes, ['SettingsView']);
});

test('.navigationDestination(for:) { Screen(note: $0) } is a push', () => {
  const [n] = navTo(swift(SWIFTUI), 'NoteDetailScreen');
  assert.equal(n.method, 'navigationDestination');
  assert.equal(n.kind, 'push');
});

test('.sheet and .fullScreenCover are modal; .alert is ignored', () => {
  const f = swift(SWIFTUI);
  const [sheet] = navTo(f, 'EditorScreen');
  assert.equal(sheet.method, 'sheet');
  assert.equal(sheet.kind, 'modal');
  const [cover] = navTo(f, 'OnboardingScreen');
  assert.equal(cover.method, 'fullScreenCover');
  assert.equal(cover.kind, 'modal');
  assert.ok(!f.navigation.some((n) => n.method === 'alert'));
  assert.equal(f.navigation.length, 5);
});

test('navContainer is set for views that own a NavigationStack', () => {
  const f = swift(String.raw`struct HomeView: View {
  var body: some View {
    NavigationStack { Text("x") }
  }
}
struct Row: View {
  var body: some View { Text("row") }
}
`);
  assert.equal(type(f, 'HomeView').navContainer, true);
  assert.equal(type(f, 'Row').navContainer, false);
});

// Regression: a same-file `extension HomeView` must not clear the struct's navContainer
// flag (analyze.js uses it to promote SwiftUI views to screens).
test('an extension in the same file does not reset navContainer', () => {
  const f = swift(String.raw`struct HomeView: View {
  var body: some View {
    NavigationStack { Text("x") }
  }
}
extension HomeView {
  func helper() {}
}
`);
  assert.equal(type(f, 'HomeView', 'struct').navContainer, true);
});

// ---------------------------------------------------------------- UIKit

const UIKIT = String.raw`
import UIKit

final class ListViewController: UIViewController, UITableViewDelegate {
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let vc = DetailViewController()
        navigationController?.pushViewController(vc, animated: true)
    }
    func showModal() {
        let editor = EditorViewController(note: nil)
        present(editor, animated: true)
    }
    func goSegue() {
        performSegue(withIdentifier: "showDetail", sender: nil)
    }
    func fromStoryboard() {
        let vc = storyboard?.instantiateViewController(withIdentifier: "ProfileVC") as! ProfileViewController
        navigationController?.pushViewController(vc, animated: true)
    }
}
`;

test('pushViewController collects view controllers created earlier in the function', () => {
  const f = swift(UIKIT);
  const [n] = navTo(f, 'DetailViewController');
  assert.equal(n.method, 'pushViewController');
  assert.equal(n.kind, 'push');
  assert.equal(n.fromType, 'ListViewController');
  assert.equal(n.line, 7);
  assert.deepEqual(type(f, 'ListViewController').inherits, ['UIViewController', 'UITableViewDelegate']);
});

test('present(...) is modal', () => {
  const [n] = navTo(swift(UIKIT), 'EditorViewController');
  assert.equal(n.method, 'present');
  assert.equal(n.kind, 'modal');
});

test('performSegue(withIdentifier:) records the segue identifier', () => {
  const n = swift(UIKIT).navigation.find((x) => x.method === 'performSegue');
  assert.deepEqual(n, {
    method: 'performSegue', kind: 'segue', line: 14, classes: [], expr: 'showDetail', segue: 'showDetail', fromType: 'ListViewController',
  });
});

test('instantiateViewController(withIdentifier:) and as! casts name the target', () => {
  const n = swift(UIKIT).navigation.find((x) => x.line === 18);
  assert.deepEqual(n.classes, ['ProfileVC', 'ProfileViewController']);
});

// ---------------------------------------------------------------- APIs

const SERVICE = String.raw`
import Foundation
import Alamofire
import Moya

enum API {
    static let baseURL = "https://api.notes.dev"
    static var version: String { return "v1" }
}

enum Endpoint: String {
    case notes = "/v1/notes"
    case profile = "/v1/me"
}

final class NotesService {
    func create(_ note: Note) async throws {
        let url = URL(string: "\(API.baseURL)/notes")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        _ = try await URLSession.shared.data(for: request)
    }
    func sync() {
        AF.request("https://x.dev/sync", method: .post).response { _ in }
    }
    func fetch() {
        AF.request(API.baseURL + "/items").responseDecodable(of: [Item].self) { _ in }
    }
    func listen() {
        let task = URLSession.shared.webSocketTask(with: URL(string: "wss://ws.notes.dev")!)
        task.resume()
    }
    func store() {
        db.collection("notes").addDocument(data: [:])
    }
}

enum NotesTarget: TargetType {
    case users
    case user(id: Int)
    var path: String {
        switch self {
        case .users: return "/users"
        case .user(let id): return "/users/\(id)"
        }
    }
}
`;

test('URLRequest(url:) picks up request.httpMethod = "POST"', () => {
  assert.deepEqual(api(swift(SERVICE), 'url'), { method: 'POST', expr: 'url', client: 'URLSession', line: 19 });
});

test('URLRequest httpMethod from an enum rawValue', () => {
  const f = swift('func put() {\n  var r = URLRequest(url: endpoint)\n  r.httpMethod = HTTPMethod.put.rawValue\n}\n');
  assert.equal(api(f, 'endpoint').method, 'PUT');
});

test('URLRequest without httpMethod defaults to GET', () => {
  const f = swift('func a() {\n  let r = URLRequest(url: u1)\n  session.dataTask(with: r).resume()\n}\n');
  assert.equal(api(f, 'u1').method, 'GET');
});

// Regression: httpMethod is read from the same request variable inside the same function.
test('URLRequest does not borrow httpMethod from a later, unrelated request', () => {
  const f = swift(`func a() {
    let r = URLRequest(url: u1)
    session.dataTask(with: r).resume()
}
func b() {
    var r2 = URLRequest(url: u2)
    r2.httpMethod = "DELETE"
}
`);
  assert.equal(api(f, 'u1').method, 'GET');
  assert.equal(api(f, 'u2').method, 'DELETE');
});

test('AF.request with method: .post, and the GET default', () => {
  const f = swift(SERVICE);
  assert.deepEqual(api(f, '"https://x.dev/sync"'), { method: 'POST', expr: '"https://x.dev/sync"', client: 'Alamofire', line: 24 });
  assert.equal(api(f, 'API.baseURL + "/items"').method, 'GET');
});

test('Moya var path: String { switch self { case ...: return ... } }', () => {
  const moya = swift(SERVICE).apis.filter((a) => a.client === 'Moya');
  assert.deepEqual(moya.map((a) => [a.label, a.expr, a.method]), [
    ['.users', '"/users"', 'API'],
    ['.user(let id)', String.raw`"/users/\(id)"`, 'API'],
  ]);
});

test('Firestore collection and webSocketTask', () => {
  const f = swift(SERVICE);
  assert.equal(api(f, '"notes"').method, 'FIRESTORE');
  const ws = api(f, 'URL(string: "wss://ws.notes.dev")!');
  assert.equal(ws.method, 'WS');
  assert.equal(ws.client, 'URLSession');
});

test('URL literals not consumed by a call are reported once', () => {
  const f = swift(SERVICE);
  const urls = f.apis.filter((a) => a.method === 'URL').map((a) => a.expr);
  assert.deepEqual(urls, ['"https://api.notes.dev"']);
  assert.deepEqual(f.bases, [{ expr: '"https://api.notes.dev"', line: 7 }]);
});

test('constants: static let, static computed var and String enum raw values', () => {
  const f = swift(SERVICE);
  const c = (owner, name) => f.constants.find((x) => x.owner === owner && x.name === name);
  assert.deepEqual(c('API', 'baseURL'), { owner: 'API', name: 'baseURL', expr: '"https://api.notes.dev"' });
  assert.equal(c('API', 'version').expr, '"v1"');
  assert.deepEqual(c('Endpoint', 'notes'), { owner: 'Endpoint', name: 'notes', expr: '"/v1/notes"', enumValue: true });
  assert.equal(c('Endpoint', 'profile').expr, '"/v1/me"');
  // switch cases in a computed property are not enum raw values
  assert.ok(!f.constants.some((x) => x.owner === 'NotesTarget'));
});

// ---------------------------------------------------------------- functions + flags

test('function complexity counts guard/if/case/&&/||/??/ternary', () => {
  const f = swift(`struct S {
  func score(_ x: Int?) -> Int {
    guard let x else { return 0 }
    if x > 1 && x < 5 || x == 9 { return 1 }
    switch x { case 1: return 1
    case 2: return 2
    default: break }
    let y = x ?? 0
    return y > 0 ? y : -y
  }
}
`);
  assert.deepEqual(f.functions, [{ name: 'score', line: 2, loc: 9, complexity: 9 }]);
});

test('computed var body counts as a function; protocol requirements do not', () => {
  const f = swift(SWIFTUI);
  assert.deepEqual(f.functions.map((fn) => fn.name), ['body', 'body']);
});

test('test detection via XCTest, Testing, @testable import and paths', () => {
  assert.equal(swift('import XCTest\nfinal class T: XCTestCase {}').isTest, true);
  assert.equal(swift('import Testing\n').isTest, true);
  assert.equal(swift('@testable import Notes\nclass T {}').isTest, true);
  assert.equal(swift('', 'NotesTests/LoginTests.swift').isTest, true);
  assert.equal(swift('', 'App/LoginSpec.swift').isTest, true);
  assert.equal(swift('import SwiftUI\n').isTest, false);
  assert.equal(swift('', 'App/Latest.swift').isTest, false);
  assert.deepEqual(swift('@testable import Notes\nimport UIKit').imports, [
    { kind: 'testable', uri: 'Notes' },
    { kind: 'import', uri: 'UIKit' },
  ]);
});

test('generated file detection', () => {
  assert.equal(swift('', 'App/R.generated.swift').isGenerated, true);
  assert.equal(swift('', 'App/Model.pb.swift').isGenerated, true);
  assert.equal(swift('// Generated using SwiftGen\nenum L10n {}').isGenerated, true);
  assert.equal(swift('struct A {}').isGenerated, false);
});

// ---------------------------------------------------------------- storyboards

const STORYBOARD = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" initialViewController="nav-1">
    <scenes>
        <scene sceneID="s1">
            <objects>
                <navigationController id="nav-1" sceneMemberID="viewController">
                    <connections>
                        <segue destination="vc-list" kind="relationship" relationship="rootViewController" id="seg-root"/>
                    </connections>
                </navigationController>
            </objects>
        </scene>
        <scene sceneID="s2">
            <objects>
                <viewController storyboardIdentifier="ListVC" id="vc-list" customClass="ListViewController" customModule="Notes" sceneMemberID="viewController">
                    <connections>
                        <segue destination="vc-detail" kind="show" identifier="showDetail" id="seg-show"/>
                    </connections>
                </viewController>
            </objects>
        </scene>
        <scene sceneID="s3">
            <objects>
                <tableViewController id="vc-detail" customClass="DetailViewController" sceneMemberID="viewController"/>
            </objects>
        </scene>
        <scene sceneID="s4">
            <objects>
                <viewController id="vc-plain" sceneMemberID="viewController"/>
                <placeholder placeholderIdentifier="IBFirstResponder" id="fr" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
</document>`;

test('storyboard: initial navigation controller scene is a container', () => {
  const sb = analyzeStoryboard('Main.storyboard', STORYBOARD);
  assert.equal(sb.path, 'Main.storyboard');
  assert.equal(sb.initial, 'nav-1');
  assert.deepEqual(sb.scenes.get('nav-1'), { className: 'UINavigationController', storyboardId: null, isContainer: true });
});

test('storyboard: custom classes, storyboard ids and UIKit fallbacks', () => {
  const sb = analyzeStoryboard('Main.storyboard', STORYBOARD);
  assert.ok(sb.scenes instanceof Map);
  assert.equal(sb.scenes.size, 4);
  assert.deepEqual(sb.scenes.get('vc-list'), { className: 'ListViewController', storyboardId: 'ListVC', isContainer: false });
  assert.equal(sb.scenes.get('vc-detail').className, 'DetailViewController');
  assert.equal(sb.scenes.get('vc-plain').className, 'UIViewController');
});

test('storyboard: rootViewController relationship and a show segue with identifier', () => {
  const sb = analyzeStoryboard('Main.storyboard', STORYBOARD);
  assert.deepEqual(sb.segues, [
    { from: 'nav-1', to: 'vc-list', kind: 'relationship', relationship: 'rootViewController', identifier: null },
    { from: 'vc-list', to: 'vc-detail', kind: 'show', relationship: null, identifier: 'showDetail' },
  ]);
  // the initial container resolves to its root view controller's custom class
  const rel = sb.segues.find((s) => s.from === sb.initial && s.relationship === 'rootViewController');
  assert.equal(sb.scenes.get(rel.to).className, 'ListViewController');
});

test('storyboard without an initial view controller', () => {
  const sb = analyzeStoryboard('Empty.storyboard', '<document><scenes></scenes></document>');
  assert.equal(sb.initial, null);
  assert.equal(sb.scenes.size, 0);
  assert.deepEqual(sb.segues, []);
});

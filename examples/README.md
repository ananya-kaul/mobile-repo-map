# Examples

Two small, realistic mobile apps used as demos and as test fixtures for MobileRepoMap.
They are meant to be **read**, not built: the code is idiomatic and plausible, but neither
project is wired up to compile (the Xcode project file is a trimmed stub).

| Example | Stack | What it exercises |
| --- | --- | --- |
| [`flutter_shop/`](flutter_shop) | Flutter · go_router · Riverpod · Dio · Firestore | Enhanced-enum routes, nested `GoRoute`s, every common navigation call style, Dio + Firestore endpoints, an import cycle, a deliberately complex screen, a "god" utility, partial test coverage |
| [`swiftui_notes/`](swiftui_notes) | SwiftUI (+ a little UIKit) · URLSession · Alamofire | `@main` entry, `TabView`/`NavigationStack`, `NavigationLink`, `.navigationDestination`, `.sheet`, `.fullScreenCover`, a `UIViewControllerRepresentable` that pushes and presents UIKit controllers, URLSession/Alamofire/WebSocket endpoints, a deliberately complex sync engine |

## Run it

```sh
npx mobile-repo-map examples/flutter_shop
npx mobile-repo-map examples/swiftui_notes
```

## flutter_shop

An e-commerce app split into feature folders (`auth`, `catalog`, `cart`, `checkout`,
`orders`, `profile`), each with `presentation/`, `data/` and `application/` layers.

- **Routes**: `lib/router/app_routes.dart` declares `enum AppRoute { splash('/splash'), … }`;
  `lib/router/app_router.dart` maps each one to a screen with `GoRoute`, including a nested
  `reviews` child under `/product/:id` and an `/orders` route whose builder wraps the screen
  in `AppScaffold`.
- **Navigation styles**: `context.go`, `context.push` with an enum path and with an
  interpolated string, `context.pushNamed('checkout')`,
  `Navigator.of(context).push(MaterialPageRoute(...))`, `showModalBottomSheet`, a push from
  inside the reusable `ProductCard` widget, and a redirect from `AuthController.logout()`
  through `GoRouter.of(rootNavigatorKey.currentContext)`.
- **Networking**: one `Dio` built from `ApiConfig.baseUrl`; repositories call
  `/products`, `/products/$id`, `/cart/items`, `/checkout`, `/orders`, `/auth/login`, and
  orders also read the Firestore `orders` collection.
- **Planted risks**:
  - import cycle: `features/cart/data/cart_repository.dart` ⇄
    `features/checkout/application/checkout_service.dart`
  - complex file: `features/checkout/presentation/checkout_screen.dart` (one large `build`
    full of nested branches, `switch`es and boolean chains)
  - "god" utility: `core/utils/formatters.dart`, imported across most screens
  - only four test files; every screen is untested

## swiftui_notes

A notes app with SwiftUI screens, an `ObservableObject` store, an `@Observable` settings
model, file-based persistence and a sync engine.

- **Entry**: `NotesApp.swift` (`@main`) → `RootTabView` (tabs: notes, search, settings;
  onboarding as a full-screen cover).
- **Navigation**: `NavigationLink(value:)` + `.navigationDestination(for: Note.self)`,
  `NavigationLink { … } label: { … }`, `NavigationLink(destination:)`, `.sheet`,
  `.fullScreenCover`, and a UIKit scanner (`ScannerView` → `ScannerViewController`) that
  presents the system document camera and pushes `ScanResultViewController`.
- **Reusable views** that are not screens: `NoteRow` (which links to `NoteDetailScreen`),
  `TagChip`, `EmptyStateView`.
- **Networking**: `APIClient` (URLSession, `Endpoint` enum, `APIConfig.baseURL`), an
  Alamofire sync call, and a WebSocket in `RealtimeClient`; Alamofire is declared as a Swift
  package in `NotesApp.xcodeproj/project.pbxproj`.
- **Planted risks**: `Sync/SyncEngine.swift` is deliberately branch-heavy; only
  `NotesStore` and `SyncEngine` have tests, so every screen is untested.

import path from 'node:path';
import { readIfExists } from './scan.js';

/** Minimal pubspec reader: package name plus dependency names. */
export function parsePubspec(text) {
  const name = (text.match(/^name:\s*([\w-]+)/m) || [])[1] || null;
  const deps = [];
  const devDeps = [];
  let section = null;
  for (const line of text.split('\n')) {
    const top = line.match(/^([a-z_]+):\s*$/);
    if (top) { section = top[1]; continue; }
    if (/^\S/.test(line)) { section = null; continue; }
    const dep = line.match(/^ {2}([A-Za-z_][\w]*):/);
    if (!dep) continue;
    if (section === 'dependencies') deps.push(dep[1]);
    else if (section === 'dev_dependencies') devDeps.push(dep[1]);
  }
  return { name, deps: deps.filter((d) => d !== 'flutter'), devDeps };
}

/** Detects platforms, package names and declared dependencies. */
export function detectProject(root, allFiles) {
  const platforms = new Set();
  const packages = new Map(); // dart package name -> lib dir (relative)
  const dependencies = new Set();
  let name = path.basename(path.resolve(root));

  const pubspecs = allFiles.filter((f) => f === 'pubspec.yaml' || f.endsWith('/pubspec.yaml'));
  for (const p of pubspecs) {
    const text = readIfExists(path.join(root, p));
    if (!text) continue;
    const spec = parsePubspec(text);
    const dir = path.posix.dirname(p);
    if (spec.name) packages.set(spec.name, dir === '.' ? 'lib' : `${dir}/lib`);
    if (/^\s+flutter:\s*$/m.test(text) || /sdk:\s*flutter/.test(text)) platforms.add('flutter');
    else platforms.add('dart');
    if (p === 'pubspec.yaml' && spec.name) name = spec.name;
    spec.deps.forEach((d) => dependencies.add(d));
  }

  const xcodeprojs = new Set();
  for (const f of allFiles) {
    const m = f.match(/(^|\/)([^/]+)\.xcodeproj\//);
    if (m) xcodeprojs.add(m[2]);
    if (f.endsWith('Package.swift')) platforms.add('swift-package');
  }
  // A Flutter app always ships Runner.xcodeproj; that alone is not a native iOS app.
  const nativeProjects = [...xcodeprojs].filter((x) => x !== 'Runner');
  if (nativeProjects.length) platforms.add('ios');
  if (!pubspecs.length && nativeProjects.length) name = nativeProjects[0];

  for (const f of allFiles) {
    if (f.endsWith('Podfile')) {
      const text = readIfExists(path.join(root, f)) || '';
      for (const m of text.matchAll(/^\s*pod\s+['"]([^'"/]+)/gm)) dependencies.add(m[1]);
    }
    if (f.endsWith('Package.swift') && !f.includes('/.build/')) {
      const text = readIfExists(path.join(root, f)) || '';
      for (const m of text.matchAll(/\.package\(\s*(?:name:\s*"[^"]*",\s*)?url:\s*"([^"]+)"/g)) {
        dependencies.add(m[1].replace(/\.git$/, '').split('/').pop());
      }
      if (!pubspecs.length && !nativeProjects.length) {
        const pn = text.match(/name:\s*"([^"]+)"/);
        if (pn) name = pn[1];
      }
    }
    if (f.endsWith('project.pbxproj')) {
      const text = readIfExists(path.join(root, f)) || '';
      for (const m of text.matchAll(/repositoryURL = "([^"]+)"/g)) {
        dependencies.add(m[1].replace(/\.git$/, '').split('/').pop());
      }
    }
  }

  return { name, platforms: [...platforms], packages, dependencies: [...dependencies].sort() };
}

/** Recognizes well-known libraries to describe the stack. */
export function describeStack(dependencies, sources) {
  const has = (d) => dependencies.includes(d);
  const anyText = (re) => sources.some((s) => re.test(s.text));
  const stack = { stateManagement: [], navigation: [], networking: [], storage: [], backend: [] };
  const add = (k, v, cond) => { if (cond && !stack[k].includes(v)) stack[k].push(v); };

  add('stateManagement', 'Riverpod', has('flutter_riverpod') || has('riverpod') || has('hooks_riverpod'));
  add('stateManagement', 'Bloc', has('flutter_bloc') || has('bloc'));
  add('stateManagement', 'Provider', has('provider'));
  add('stateManagement', 'GetX', has('get'));
  add('stateManagement', 'MobX', has('mobx') || has('flutter_mobx'));
  add('stateManagement', 'Redux', has('flutter_redux') || has('redux'));
  add('stateManagement', 'Signals', has('signals') || has('signals_flutter'));
  add('stateManagement', 'Combine', anyText(/^import Combine/m));
  add('stateManagement', 'ObservableObject', anyText(/:\s*[^{]*\bObservableObject\b/));
  add('stateManagement', '@Observable', anyText(/@Observable\b/));
  add('stateManagement', 'TCA', has('swift-composable-architecture'));
  add('stateManagement', 'RxSwift', has('RxSwift') || has('RxSwift'));

  add('navigation', 'go_router', has('go_router'));
  add('navigation', 'auto_route', has('auto_route'));
  add('navigation', 'beamer', has('beamer'));
  add('navigation', 'GetX routing', has('get'));
  add('navigation', 'Navigator', anyText(/\bNavigator\.(of|push)/));
  add('navigation', 'NavigationStack', anyText(/\bNavigationStack\b/));
  add('navigation', 'NavigationView', anyText(/\bNavigationView\b/));
  add('navigation', 'UINavigationController', anyText(/\bUINavigationController\b/));
  add('navigation', 'Storyboards', anyText(/instantiateViewController|performSegue/));

  add('networking', 'dio', has('dio'));
  add('networking', 'http', has('http'));
  add('networking', 'retrofit', has('retrofit'));
  add('networking', 'chopper', has('chopper'));
  add('networking', 'graphql', has('graphql_flutter') || has('graphql') || has('Apollo') || has('apollo-ios'));
  add('networking', 'web_socket_channel', has('web_socket_channel'));
  add('networking', 'socket.io', has('socket_io_client') || has('Socket.IO-Client-Swift'));
  add('networking', 'URLSession', anyText(/\bURLSession\b/));
  add('networking', 'Alamofire', has('Alamofire') || anyText(/^import Alamofire/m));
  add('networking', 'Moya', has('Moya') || anyText(/^import Moya/m));

  add('storage', 'shared_preferences', has('shared_preferences'));
  add('storage', 'hive', has('hive') || has('hive_flutter'));
  add('storage', 'isar', has('isar'));
  add('storage', 'sqflite', has('sqflite'));
  add('storage', 'drift', has('drift'));
  add('storage', 'secure storage', has('flutter_secure_storage'));
  add('storage', 'Core Data', anyText(/^import CoreData/m));
  add('storage', 'SwiftData', anyText(/^import SwiftData/m));
  add('storage', 'Realm', has('RealmSwift') || has('realm-swift') || has('realm'));
  add('storage', 'UserDefaults', anyText(/\bUserDefaults\b/));
  add('storage', 'Keychain', anyText(/\bkSecClass\b|KeychainAccess|KeychainSwift/));

  add('backend', 'Firebase', dependencies.some((d) => /^(firebase|cloud_firestore)|^Firebase|firebase-ios-sdk/i.test(d)));
  add('backend', 'Supabase', dependencies.some((d) => /supabase/i.test(d)));
  add('backend', 'RevenueCat', dependencies.some((d) => /purchases|RevenueCat/i.test(d)));
  add('backend', 'Sentry', dependencies.some((d) => /sentry/i.test(d)));
  return stack;
}

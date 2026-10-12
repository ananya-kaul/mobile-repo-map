import 'package:flutter/widgets.dart';

/// Root navigator key, shared with code that has no BuildContext
/// (for example notifiers that redirect after a session ends).
final rootNavigatorKey = GlobalKey<NavigatorState>();

enum AppRoute {
  splash('/splash'),
  home('/'),
  product('/product/:id'),
  cart('/cart'),
  checkout('/checkout'),
  orders('/orders'),
  profile('/profile'),
  login('/login'),
  settings('/settings');

  const AppRoute(this.path);

  final String path;
}
